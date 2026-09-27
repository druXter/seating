// app/api/suite/callback/route.ts
import type { NextRequest, NextResponse } from 'next/server'
import { fetchDiscovery, sanitizeNextPath, verifyLoginAssertion, type DiscoveryDocument, type IdpConfig, type LoginClaims } from 'suite-kit'
import { prisma } from '../../../lib/prisma'
import { cookieOptions, getCurrentUser, issueSession, SESSION_COOKIE, SESSION_DURATION_MS } from '../../../lib/auth'
import { normalizeEmail } from '../../../lib/form'
import { safeEqual } from '../../../lib/permissions'
import { getIdps, mapRole, selfOrigin } from '../../../lib/suite'
import { parseFlow, redirectResponse, SUITE_STATE_COOKIE } from '../../../lib/suite-flow'

export const dynamic = 'force-dynamic'

/** Wie oft pro Anbieter das Discovery-Dokument wegen unbekannter Schlüssel-ID neu geladen werden darf. */
const FORCED_REFRESH_INTERVAL_MS = 60 * 1000
const lastForcedRefresh = new Map<string, number>()

async function loadDiscoveryForVerification(issuer: string, force: boolean): Promise<DiscoveryDocument | null> {
  if (force) {
    // Ohne diese Bremse könnte jeder mit einem state-Cookie beliebig viele erzwungene Abrufe beim
    // Anbieter auslösen, indem er Bestätigungen mit erfundener Schlüssel-ID schickt.
    const last = lastForcedRefresh.get(issuer) ?? 0
    if (Date.now() - last < FORCED_REFRESH_INTERVAL_MS) return null
    lastForcedRefresh.set(issuer, Date.now())
  }
  return fetchDiscovery(issuer, { force })
}

/**
 * EMPFÄNGER-Seite, Schritt 3: Der Anbieter schickt den Browser mit einer signierten Login-Bestätigung
 * hierher zurück. Geprüft wird: Cookie mit `state` vorhanden UND gleich dem zurückgegebenen `state`
 * (bindet den Vorgang an genau diesen Browser), Anbieter konfiguriert, Signatur gültig, `aud` = dieses
 * Tool, `nonce` = `state`, nicht abgelaufen. Das state-Cookie wird in JEDEM Fall gelöscht - eine
 * Bestätigung ist nur einmal nutzbar. Fehler sehen Nutzende nur als allgemeine Meldung, der genaue
 * Grund steht im Server-Log.
 *
 * Dass hier auf GET ein Konto bzw. eine Sitzung entsteht, ist durch das Protokoll vorgegeben (Rücksprung
 * per Redirect) - ohne das state-Cookie dieses Browsers bewirkt ein Aufruf nichts.
 */
export async function GET(request: NextRequest) {
  const origin = selfOrigin()
  const requestOrigin = request.nextUrl.origin
  const flow = parseFlow(request.cookies.get(SUITE_STATE_COOKIE)?.value)

  const finish = (response: NextResponse): NextResponse => {
    response.cookies.set(SUITE_STATE_COOKIE, '', { ...cookieOptions(0), maxAge: 0 })
    return response
  }
  // Beim Verknüpfen mit Sitzung auf die Konto-Seite - /login würde eine eingeloggte Person sofort
  // weiterleiten und die Meldung verschlucken. Ohne Sitzung (abgelaufen, anderswo abgemeldet) umgekehrt:
  // /account leitete selbst zum Login und der Fehlercode ginge verloren.
  const fail = async (code: string, detail?: string): Promise<NextResponse> => {
    if (detail) console.warn(`[suite] Anmeldung abgelehnt (${code}): ${detail}`)
    const toAccount = flow?.mode === 'link' && (await getCurrentUser()) !== null
    return finish(redirectResponse(`${toAccount ? '/account' : '/login'}?error=${code}`, requestOrigin))
  }

  const assertion = request.nextUrl.searchParams.get('assertion')
  const stateParam = request.nextUrl.searchParams.get('state')
  if (!origin || !flow || !assertion || !stateParam || !safeEqual(stateParam, flow.state)) {
    return fail('sso', 'state fehlt oder stimmt nicht überein')
  }

  const idp = getIdps().find(i => i.issuer === flow.issuer)
  if (!idp) return fail('sso', 'Anbieter nicht (mehr) konfiguriert')

  let discovery = await fetchDiscovery(idp.issuer)
  if (!discovery) return fail('idp-unreachable')

  const expectation = () => ({ issuer: idp.issuer, audience: origin, nonce: flow.state, keys: discovery!.keys })
  let result = verifyLoginAssertion(assertion, expectation())
  if (!result.ok && result.reason === 'unknown-key') {
    // Vermutlich Schlüsselrotation beim Anbieter: EINMAL frisch laden und erneut prüfen.
    discovery = await loadDiscoveryForVerification(idp.issuer, true)
    if (discovery) result = verifyLoginAssertion(assertion, expectation())
  }
  if (!result.ok) return fail('sso', `Bestätigung ungültig: ${result.reason}`)

  const claims = result.claims
  const next = sanitizeNextPath(flow.next, flow.mode === 'link' ? '/account' : '/admin')

  const identity = await prisma.externalIdentity.findUnique({
    where: { issuer_subject: { issuer: claims.iss, subject: claims.sub } },
    include: { user: { select: { id: true, email: true, passwordHash: true } } }
  })

  if (flow.mode === 'link') {
    const current = await getCurrentUser()
    if (!current) return fail('sso', 'Verknüpfung ohne Sitzung')
    if (identity && identity.userId !== current.id) return fail('linked-other')
    if (!identity) {
      try {
        await prisma.externalIdentity.create({ data: { issuer: claims.iss, subject: claims.sub, userId: current.id } })
      } catch (error) {
        // Gleichzeitig von anderer Stelle verknüpft (Unique-Verstoß).
        return fail('linked-other', (error as Error).message)
      }
    }
    return finish(redirectResponse(`${next}${next.includes('?') ? '&' : '?'}linked=1`, requestOrigin))
  }

  const userId = identity ? await syncExistingUser(identity.user, claims) : await provisionUser(idp, claims)
  if (typeof userId !== 'string') return fail(userId.code, userId.detail)

  const token = await issueSession(userId)
  const response = finish(redirectResponse(next, requestOrigin))
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_DURATION_MS / 1000))
  return response
}

/**
 * Bekannte Verknüpfung: Bei rein föderierten Konten (ohne eigenes Passwort) wird eine beim Anbieter
 * geänderte E-Mail-Adresse nachgezogen, sofern sie hier nicht schon vergeben ist. Konten mit eigenem
 * Passwort behalten ihre lokale Adresse.
 */
async function syncExistingUser(user: { id: string; email: string; passwordHash: string | null }, claims: LoginClaims): Promise<string> {
  const email = normalizeEmail(claims.email)
  if (user.passwordHash === null && email && user.email !== email) {
    const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (!taken) await prisma.user.update({ where: { id: user.id }, data: { email } })
  }
  return user.id
}

/**
 * Unbekannte Verknüpfung beim Login: legt ein Konto ohne Passwort an (falls für diesen Anbieter
 * erlaubt). Bewusst KEIN automatisches Zusammenführen mit einem bestehenden lokalen Konto über die
 * E-Mail - das wäre eine Übernahme-Lücke, sobald ein Anbieter Adressen weniger streng prüft. Wer hier
 * schon ein Konto hat, verknüpft es bewusst unter /account aus einer bestehenden Sitzung heraus.
 */
async function provisionUser(idp: IdpConfig, claims: LoginClaims): Promise<string | { code: string; detail?: string }> {
  const email = normalizeEmail(claims.email)
  if (!email) return { code: 'sso', detail: 'Bestätigung ohne gültige E-Mail-Adresse' }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return { code: 'email-taken' }
  if (!idp.autoProvision) return { code: 'not-linked' }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name: claims.name?.trim().slice(0, 100) || null,
        role: mapRole(idp, claims.role),
        identities: { create: { issuer: claims.iss, subject: claims.sub } }
      }
    })
    return user.id
  } catch (error) {
    // Gleichzeitiger zweiter Login mit derselben Person (Unique-Verstoß) - einfach neu versuchen lassen.
    return { code: 'sso', detail: `Konto konnte nicht angelegt werden: ${(error as Error).message}` }
  }
}
