import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMessage, verifyMessage, type Message } from '../../app/lib/rsvp/token'

// Test-Doppel für rsvp-app (Phase 7), damit die E2E-Tests ohne echte rsvp-app laufen: beantwortet die
// signierte Anfrage nach der Gästeliste (aus RSVP_DIR/guests-<rsvpEventId>.json, sonst 404 = "nicht
// verknüpft") und nimmt Platzierungen an (letzter Stand in RSVP_DIR/placements-<rsvpEventId>.json).
// Prüft dabei alles so, wie rsvp-app es tun soll: Signatur, Art, Empfänger, Gültigkeit.

export const RSVP_PORT = 2527
export const RSVP_ORIGIN = `http://127.0.0.1:${RSVP_PORT}`
export const RSVP_DIR = 'data/test-rsvp'
export const TEST_RSVP_SECRET = 'e2e-rsvp-seating-secret-0123456789abcdef'

export type TestGuest = Message<'guest-list'>['guests'][number]

export function setGuestList(rsvpEventId: string, guests: TestGuest[] | null) {
  mkdirSync(RSVP_DIR, { recursive: true })
  const file = join(RSVP_DIR, `guests-${rsvpEventId}.json`)
  if (guests === null) rmSync(file, { force: true })
  else writeFileSync(file, JSON.stringify(guests))
}

export function placementsOf(rsvpEventId: string): { rsvpId: string; label: string }[] | null {
  const file = join(RSVP_DIR, `placements-${rsvpEventId}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

/** Wartet, bis rsvp-app einen Stand mit dieser Bedingung bekommen hat (Meldungen laufen nach der Antwort). */
export async function waitForPlacements(rsvpEventId: string, check: (placements: { rsvpId: string; label: string }[]) => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const placements = placementsOf(rsvpEventId)
    if (placements && check(placements)) return placements
    if (Date.now() > deadline) throw new Error(`Keine passende Platzierung für ${rsvpEventId}: ${JSON.stringify(placements)}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

export function startRsvpServer(seatingOrigin: string): Promise<Server> {
  rmSync(RSVP_DIR, { recursive: true, force: true })
  mkdirSync(RSVP_DIR, { recursive: true })
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const options = { secret: TEST_RSVP_SECRET, audience: RSVP_ORIGIN }
      if (request.method === 'POST' && request.url === '/api/seating/guest-list') {
        const message = verifyMessage(body, 'guest-list-request', options)
        if (!message) return response.writeHead(401).end('invalid')
        const file = join(RSVP_DIR, `guests-${message.rsvpEventId}.json`)
        if (!existsSync(file)) return response.writeHead(404).end('not linked')
        const guests = JSON.parse(readFileSync(file, 'utf8')) as TestGuest[]
        const answer = createMessage('guest-list', { aud: seatingOrigin, seatingEventId: message.seatingEventId, rsvpEventId: message.rsvpEventId, guests }, TEST_RSVP_SECRET)
        return response.writeHead(200, { 'Content-Type': 'text/plain' }).end(answer)
      }
      if (request.method === 'POST' && request.url === '/api/seating/placements') {
        const message = verifyMessage(body, 'placements', options)
        if (!message) return response.writeHead(401).end('invalid')
        writeFileSync(join(RSVP_DIR, `placements-${message.rsvpEventId}.json`), JSON.stringify(message.placements))
        return response.writeHead(200).end('ok')
      }
      response.writeHead(404).end('not found')
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(RSVP_PORT, '127.0.0.1', () => resolve(server))
  })
}
