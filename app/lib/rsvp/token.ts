// app/lib/rsvp/token.ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { normalizeEmail } from '../form'
import { cleanName, MAX_PARTY } from '../events/assign-rules'

/**
 * Vertrag zwischen Seating und rsvp-app (docs/KONZEPT.md Abschnitt 9, Phase 7). Format wie im Vertrag
 * zwischen rsvp-app und Abstimmungstool (dort app/lib/rsvp-verification.ts) - bewusst ohne JWT-Bibliothek:
 *
 *   base64url(JSON-Payload) "." base64url(HMAC-SHA256(payloadPart, RSVP_SEATING_SECRET))
 *
 * Anders als dort trägt JEDE Nachricht:
 * - typ: die Art (seat-link, rsvp-change, guest-list-request, guest-list, placements). Beide Richtungen
 *   teilen sich ein Secret - ohne typ ließe sich eine Nachricht als eine andere ausgeben.
 * - aud: der Origin des Empfängers (Seating: BASE_URL, rsvp-app: RSVP_APP_BASE_URL).
 * - iat/exp: Unix-Sekunden. Angenommen wird nur, was noch gilt und höchstens eine Stunde gültig ist.
 * - seatingEventId und rsvpEventId: die Verknüpfung, die BEIDE Seiten eingetragen haben müssen.
 *
 * Identität eines Gasts ist die Zusage (rsvpId), nicht die E-Mail - die ist in rsvp-app optional.
 * Alle Prüfungen geben bei jedem Problem null zurück: "nicht gültig" ist ein normaler Zustand.
 */

export const MAX_TOKEN_AGE_SECONDS = 60 * 60
const CLOCK_SKEW_SECONDS = 60
const ID = /^[a-z0-9]{10,40}$/

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(input: string): Buffer {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function signature(payloadPart: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payloadPart).digest())
}

export function signMessage(payload: object, secret: string): string {
  const payloadPart = base64url(JSON.stringify(payload))
  return `${payloadPart}.${signature(payloadPart, secret)}`
}

/** Signatur prüfen (konstante Laufzeit) und die Nutzlast lesen - ohne inhaltliche Prüfung. */
export function openMessage(token: string, secret: string): unknown {
  if (typeof token !== 'string' || token.length > 2_000_000) return null
  const parts = token.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const expected = Buffer.from(signature(parts[0], secret))
  const actual = Buffer.from(parts[1])
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    return JSON.parse(fromBase64url(parts[0]).toString('utf8'))
  } catch {
    return null
  }
}

/** Origin einer Basis-URL ("https://plaetze.example.de/" -> "https://plaetze.example.de"), null wenn ungültig. */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// --- Inhalte ------------------------------------------------------------------------------------

const name = z.string().max(500).transform(cleanName).pipe(z.string().min(1).max(100))
const optionalName = z.string().max(500).transform(cleanName).nullable()
  .transform(value => (value ? value.slice(0, 100) : null))
const email = z.string().max(254).nullable().transform(value => (value ? normalizeEmail(value) : null))
const companions = z.array(optionalName).max(MAX_PARTY - 1)

const envelope = {
  aud: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  seatingEventId: z.string().regex(ID),
  rsvpEventId: z.string().regex(ID)
}

/** Eine Person mit Zusage, wie rsvp-app sie meldet (Link zur Platzwahl, Änderung, Gästeliste). */
const guest = { rsvpId: z.string().regex(ID), name, email, companions }

const SCHEMAS = {
  /** rsvp-app -> Seating (über den Browser): "Sitzplatz wählen" für genau diese Zusage. */
  'seat-link': z.object({ typ: z.literal('seat-link'), ...envelope, ...guest }),
  /** rsvp-app -> Seating (Webhook): Zusage geändert, abgesagt oder weg (attending false). */
  'rsvp-change': z.object({
    typ: z.literal('rsvp-change'), ...envelope, rsvpId: z.string().regex(ID), attending: z.boolean(),
    name: z.string().max(500).transform(cleanName), email, companions
  }),
  /** Seating -> rsvp-app: bitte die aktuelle Gästeliste. */
  'guest-list-request': z.object({ typ: z.literal('guest-list-request'), ...envelope }),
  /** rsvp-app -> Seating (Antwort): alle Zusagen (bestätigt, nicht auf der Warteliste). */
  'guest-list': z.object({ typ: z.literal('guest-list'), ...envelope, guests: z.array(z.object(guest)).max(5000) }),
  /** Seating -> rsvp-app: vollständiger Stand der Platzierungen (fehlende rsvpIds = kein Platz). */
  placements: z.object({
    typ: z.literal('placements'), ...envelope,
    placements: z.array(z.object({ rsvpId: z.string().regex(ID), label: z.string().max(500) })).max(5000)
  })
}

export type MessageType = keyof typeof SCHEMAS
export type Message<T extends MessageType> = z.infer<(typeof SCHEMAS)[T]>

/**
 * Prüft Signatur, Art, Empfänger und Gültigkeit einer Nachricht und gibt ihren Inhalt zurück (Namen
 * bereinigt, E-Mail normalisiert) - oder null.
 */
export function verifyMessage<T extends MessageType>(
  token: string, type: T, options: { secret: string; audience: string; now?: Date }
): Message<T> | null {
  const raw = openMessage(token, options.secret)
  const parsed = SCHEMAS[type].safeParse(raw)
  if (!parsed.success) return null
  const message = parsed.data as Message<T>
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (message.aud !== options.audience) return null
  if (message.exp <= now || message.exp - now > MAX_TOKEN_AGE_SECONDS) return null
  if (message.iat > now + CLOCK_SKEW_SECONDS || message.iat > message.exp) return null
  return message
}

/** Signiert eine Nachricht mit iat/exp (Standard 10 Minuten gültig). */
export function createMessage<T extends MessageType>(
  type: T, content: Omit<Message<T>, 'typ' | 'iat' | 'exp'>, secret: string, options: { now?: Date; ttlSeconds?: number } = {}
): string {
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000)
  return signMessage({ typ: type, ...content, iat, exp: iat + (options.ttlSeconds ?? 600) }, secret)
}
