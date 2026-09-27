// app/api/suite/login/route.ts
import type { NextRequest } from 'next/server'
import { buildAuthorizeRequestUrl, fetchDiscovery, normalizeOrigin, randomState, sanitizeNextPath } from 'suite-kit'
import { cookieOptions, getCurrentUser } from '../../../lib/auth'
import { getIdps, selfOrigin } from '../../../lib/suite'
import { redirectResponse, SUITE_STATE_COOKIE, SUITE_STATE_MAX_AGE_SECONDS, type SuiteFlow } from '../../../lib/suite-flow'

export const dynamic = 'force-dynamic'

/**
 * EMPFÄNGER-Seite, Schritt 1: Startet die Anmeldung mit einem Konto aus einem anderen Tool
 * (`?idp=<Origin>`). Erzeugt den einmaligen `state`, legt ihn in ein Cookie DIESES Browsers und
 * schickt den Browser zum Anbieter. Der Anbieter muss in SUITE_IDPS stehen - die Adresse kommt nie
 * ungeprüft aus der Anfrage (kein SSRF über den Discovery-Abruf).
 *
 * `mode=link` verknüpft stattdessen ein Konto mit dem bereits eingeloggten lokalen Konto (Button
 * unter /account), statt ein neues Login zu erzeugen. Gesetzt wird hier nur das kurzlebige
 * state-Cookie; Konten entstehen oder ändern sich erst im Callback.
 */
export async function GET(request: NextRequest) {
  const origin = selfOrigin()
  const params = request.nextUrl.searchParams
  const mode: SuiteFlow['mode'] = params.get('mode') === 'link' ? 'link' : 'login'
  const next = sanitizeNextPath(params.get('next'), mode === 'link' ? '/account' : '/admin')

  const issuer = normalizeOrigin(params.get('idp') ?? '')
  const idp = getIdps().find(i => i.issuer === issuer)
  if (!origin || !idp) return redirectResponse('/login?error=sso', request.nextUrl.origin)

  if (mode === 'link' && !(await getCurrentUser())) {
    return redirectResponse(`/login?next=${encodeURIComponent('/account')}`, origin)
  }

  const discovery = await fetchDiscovery(idp.issuer)
  if (!discovery) return redirectResponse(mode === 'link' ? '/account?error=idp-unreachable' : '/login?error=idp-unreachable', origin)

  const state = randomState()
  const response = redirectResponse(buildAuthorizeRequestUrl(discovery.authorizeUrl, { app: origin, state }), origin)
  const flow: SuiteFlow = { state, issuer: idp.issuer, next, mode }
  response.cookies.set(SUITE_STATE_COOKIE, JSON.stringify(flow), cookieOptions(SUITE_STATE_MAX_AGE_SECONDS))
  return response
}
