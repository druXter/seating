import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAuthorizeResponseUrl, buildDiscoveryDocument, issueLoginAssertion, loadSigner, parseAuthorizeRequest, type Signer } from 'suite-kit'

// Test-Doppel für zwei andere Tools der Suite (Phase 8), damit die Föderation ohne echtes rsvp-app oder
// Abstimmungstool geprüft werden kann. Beide sind ANBIETER für Seating (Discovery, Authorize mit einer
// von den Tests eingestellten Identität) - Tool A mit autoProvision, Tool B ohne. Tool A ist zugleich
// EMPFÄNGER von Seating-Anmeldungen: sein Callback legt die Bestätigung zur Prüfung ab.
//
// Absichtlich auf `localhost` statt 127.0.0.1 (Seating): unterschiedliche Hostnamen, sonst teilten sich
// die Tools Cookies (siehe CLAUDE.md, Stolpersteine).

export type ToolName = 'a' | 'b'
export const SUITE_TOOLS: Record<ToolName, { port: number; origin: string; label: string }> = {
  a: { port: 2528, origin: 'http://localhost:2528', label: 'Tool A' },
  b: { port: 2529, origin: 'http://localhost:2529', label: 'Tool B' }
}
export const SUITE_DIR = 'data/test-suite'

/** Konfiguration für Seating (playwright.config.ts): A legt Konten an, B nicht; A darf Seating-Anmeldungen empfangen. */
export const TEST_SUITE_IDPS = JSON.stringify([
  { issuer: SUITE_TOOLS.a.origin, label: SUITE_TOOLS.a.label, autoProvision: true },
  { issuer: SUITE_TOOLS.b.origin, label: SUITE_TOOLS.b.label, autoProvision: false }
])
export const TEST_SUITE_TRUSTED_APPS = SUITE_TOOLS.a.origin

/**
 * Feste Ed25519-Schlüssel aus einem Namen (PKCS#8 = fester Präfix + 32 Byte Seed): Server und
 * Testprozess kennen so dieselben Schlüssel, ohne sie auszutauschen. Nur für Tests.
 */
export function testSigningKey(name: string): string {
  const seed = createHash('sha256').update(`suite-e2e:${name}`).digest()
  return Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]).toString('base64url')
}
export function testSigner(name: string): Signer {
  return loadSigner(testSigningKey(name))
}

/** Schlüssel, mit dem Seating in den Tests Anmeldungen ausstellt (SUITE_SIGNING_KEY). */
export const TEST_SEATING_SIGNING_KEY = testSigningKey('seating')

/**
 * Wer beim Anbieter "eingeloggt" ist und wie er die Bestätigung ausstellt. null = niemand eingeloggt.
 * tamper: absichtlich kaputte Bestätigung - für die Sicherheitsfälle.
 */
export type TestIdentity = {
  sub: string
  email: string
  name?: string
  role?: string
  tamper?: 'signature' | 'audience' | 'nonce' | 'unknown-key' | 'issuer'
}

export function setIdentity(tool: ToolName, identity: TestIdentity | null) {
  mkdirSync(SUITE_DIR, { recursive: true })
  const file = join(SUITE_DIR, `identity-${tool}.json`)
  if (identity === null) rmSync(file, { force: true })
  else writeFileSync(file, JSON.stringify(identity))
}

/** Zuletzt an Seating ausgestellte Rücksprung-Adresse (für Wiedergabe-Tests). */
export function lastRedirectOf(tool: ToolName): string | null {
  const file = join(SUITE_DIR, `redirect-${tool}.txt`)
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

/** Was der Callback von Tool A zuletzt von Seating bekommen hat. */
export function lastCallbackOf(tool: ToolName): { assertion: string; state: string } | null {
  const file = join(SUITE_DIR, `callback-${tool}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

export function clearCallback(tool: ToolName) {
  rmSync(join(SUITE_DIR, `callback-${tool}.json`), { force: true })
}

function handler(tool: ToolName, seatingOrigin: string) {
  const { origin, label } = SUITE_TOOLS[tool]
  const signer = testSigner(tool)
  const html = (text: string) => `<!doctype html><meta charset="utf-8"><title>${label}</title><p>${text}</p>`

  return (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
    const url = new URL(request.url ?? '/', origin)

    if (url.pathname === '/.well-known/suite-identity') {
      const doc = buildDiscoveryDocument({ issuer: origin, name: label, signers: [signer] })
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(doc))
    }

    if (url.pathname === '/api/suite/authorize') {
      // Wie ein echter Anbieter: nur an freigegebene Tools (hier: Seating) eine Bestätigung ausstellen.
      const parsed = parseAuthorizeRequest(url, [seatingOrigin])
      if (!parsed.ok) return response.writeHead(400, { 'Content-Type': 'text/html' }).end(html(`Abgelehnt: ${parsed.reason}`))
      const file = join(SUITE_DIR, `identity-${tool}.json`)
      if (!existsSync(file)) return response.writeHead(200, { 'Content-Type': 'text/html' }).end(html('Bei diesem Tool ist niemand angemeldet.'))
      const identity = JSON.parse(readFileSync(file, 'utf8')) as TestIdentity

      const signWith = identity.tamper === 'unknown-key' ? testSigner(`${tool}-unbekannt`) : signer
      let assertion = issueLoginAssertion(signWith, {
        issuer: identity.tamper === 'issuer' ? SUITE_TOOLS[tool === 'a' ? 'b' : 'a'].origin : origin,
        audience: identity.tamper === 'audience' ? 'https://anderes-tool.example' : parsed.request.app,
        subject: identity.sub,
        email: identity.email,
        name: identity.name,
        role: identity.role,
        nonce: identity.tamper === 'nonce' ? 'x'.repeat(43) : parsed.request.state
      })
      if (identity.tamper === 'signature') {
        // Letztes Zeichen der Signatur ändern.
        assertion = assertion.slice(0, -2) + (assertion.slice(-2, -1) === 'A' ? 'B' : 'A') + assertion.slice(-1)
      }
      const target = buildAuthorizeResponseUrl(parsed.request, assertion)
      writeFileSync(join(SUITE_DIR, `redirect-${tool}.txt`), target)
      return response.writeHead(303, { Location: target, 'Cache-Control': 'no-store' }).end()
    }

    if (url.pathname === '/api/suite/callback') {
      writeFileSync(join(SUITE_DIR, `callback-${tool}.json`), JSON.stringify({
        assertion: url.searchParams.get('assertion') ?? '', state: url.searchParams.get('state') ?? ''
      }))
      return response.writeHead(200, { 'Content-Type': 'text/html' }).end(html('Bestätigung empfangen.'))
    }

    response.writeHead(404).end('not found')
  }
}

/**
 * `localhost` löst je nach System zu ::1 oder 127.0.0.1 auf (Browser und Node können sich dabei
 * unterscheiden) - deshalb auf beiden Loopback-Adressen lauschen, aber nie nach außen.
 */
export async function startSuiteServers(seatingOrigin: string): Promise<Server[]> {
  rmSync(SUITE_DIR, { recursive: true, force: true })
  mkdirSync(SUITE_DIR, { recursive: true })
  const listeners = (Object.keys(SUITE_TOOLS) as ToolName[]).flatMap(tool => ['127.0.0.1', '::1'].map(host => new Promise<Server>((resolve, reject) => {
    const server = createServer(handler(tool, seatingOrigin))
    server.once('error', reject)
    server.listen(SUITE_TOOLS[tool].port, host, () => resolve(server))
  })))
  return Promise.all(listeners)
}
