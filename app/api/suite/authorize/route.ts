// app/api/suite/authorize/route.ts
import type { NextRequest } from 'next/server'
import { buildAuthorizeResponseUrl, issueLoginAssertion, parseAuthorizeRequest } from 'suite-kit'
import { getCurrentUser } from '../../../lib/auth'
import { getSigners, getTrustedApps, selfOrigin } from '../../../lib/suite'
import { redirectResponse } from '../../../lib/suite-flow'

export const dynamic = 'force-dynamic'

/**
 * ANBIETER-Seite: Ein anderes Tool schickt den Browser hierher, um sich bestätigen zu lassen, wer
 * hier eingeloggt ist (Ablauf siehe suite-kit/README).
 *
 * - Nur Tools aus SUITE_TRUSTED_APPS erhalten je eine Bestätigung. Eine unbekannte `app` bekommt NIE
 *   eine Weiterleitung (sonst wäre das ein offener Redirect, der Bestätigungen an Fremde schickt),
 *   sondern landet auf einer Fehlermeldung in diesem Tool.
 * - Nicht eingeloggt: normaler Login, danach geht es über /login/continue genau hier weiter.
 * - Nur Konten MIT lokalem Passwort werden bestätigt, nie rein föderierte: Sonst könnten
 *   Vertrauensketten entstehen (A vertraut B, B vertraut C, ...) und ein Tool würde Identitäten
 *   weiterreichen, für die es selbst nicht zuständig ist.
 *
 * GET verändert hier keine Daten: Es wird nur eine kurz gültige Bestätigung ausgestellt.
 */
export async function GET(request: NextRequest) {
  const origin = selfOrigin()
  const signer = getSigners()[0]
  if (!origin || !signer) return new Response('Not found', { status: 404 })

  const parsed = parseAuthorizeRequest(request.nextUrl, getTrustedApps())
  if (!parsed.ok) {
    console.warn(`[suite] Anfrage zur Anmeldung abgelehnt (${parsed.reason})`)
    return redirectResponse('/login?error=app', origin)
  }

  const user = await getCurrentUser()
  if (!user) {
    const here = request.nextUrl.pathname + request.nextUrl.search
    return redirectResponse(`/login?next=${encodeURIComponent(here)}`, origin)
  }
  if (!user.hasPassword) return redirectResponse('/account?error=nochain', origin)

  const assertion = issueLoginAssertion(signer, {
    issuer: origin,
    audience: parsed.request.app,
    subject: user.id,
    email: user.email,
    name: user.name ?? undefined,
    role: user.role,
    nonce: parsed.request.state
  })

  return redirectResponse(buildAuthorizeResponseUrl(parsed.request, assertion), origin)
}
