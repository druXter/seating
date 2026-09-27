// app/.well-known/suite-identity/route.ts
import { buildDiscoveryDocument } from 'suite-kit'
import { appName, getSigners, selfOrigin } from '../../lib/suite'

export const dynamic = 'force-dynamic'

/**
 * Discovery-Dokument für andere Tools der Suite (siehe suite-kit/README): wer dieses Tool ist und mit
 * welchen öffentlichen Schlüsseln seine Login-Bestätigungen zu prüfen sind. Ohne SUITE_SIGNING_KEY
 * (oder BASE_URL) stellt Seating keine Anmeldungen aus und antwortet 404 - dann ist es aus Sicht der
 * anderen Tools schlicht nicht föderiert.
 */
export function GET() {
  const issuer = selfOrigin()
  const signers = getSigners()
  if (!issuer || signers.length === 0) return new Response('Not found', { status: 404 })

  return Response.json(buildDiscoveryDocument({ issuer, name: appName(), signers }), {
    headers: { 'Cache-Control': 'public, max-age=300' }
  })
}
