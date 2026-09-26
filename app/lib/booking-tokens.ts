// app/lib/booking-tokens.ts
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto'
import { safeEqual } from './permissions'

/**
 * Links und Codes für Buchende (docs/KONZEPT.md Abschnitt 6):
 *
 * | Token              | Erzeugung                                   | Speicherung          |
 * | Verifizierungslink | 32 Byte Zufall                              | nur SHA-256-Hash     |
 * | Verifizierungscode | 6 Ziffern                                   | HMAC(VERIFY_CODE_SECRET, id:code) |
 * | Verwaltungslink    | HMAC(MANAGE_LINK_SECRET, id:version)        | gar nicht            |
 *
 * Der Code wird per HMAC gespeichert, nie als reiner Hash: 10^6 Möglichkeiten wären aus einem
 * Datenbank-Abzug sofort zurückgerechnet. Der Verwaltungslink wird abgeleitet statt gespeichert,
 * damit er in jeder späteren Mail wieder auftauchen kann, ohne alte Links zu entwerten.
 *
 * Fehlen die Secrets oder sind sie zu kurz, ist das Buchen abgeschaltet (bookingSecretsConfigured) -
 * es gibt keinen unsicheren Rückfall auf einen Standardwert.
 */

const MIN_SECRET_LENGTH = 32

function secret(name: 'VERIFY_CODE_SECRET' | 'MANAGE_LINK_SECRET' | 'MANAGE_LINK_SECRET_PREVIOUS'): string | null {
  const value = process.env[name]
  return value && value.length >= MIN_SECRET_LENGTH ? value : null
}

export function bookingSecretsConfigured(): boolean {
  return secret('VERIFY_CODE_SECRET') !== null && secret('MANAGE_LINK_SECRET') !== null
}

function requireSecret(name: 'VERIFY_CODE_SECRET' | 'MANAGE_LINK_SECRET'): string {
  const value = secret(name)
  if (!value) throw new Error(`${name} fehlt oder ist kürzer als ${MIN_SECRET_LENGTH} Zeichen`)
  return value
}

function hmac(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('base64url')
}

// --- Verifizierungslink -------------------------------------------------------------------------

export function newVerifyToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashVerifyToken(token) }
}

export function hashVerifyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// --- Verifizierungscode -------------------------------------------------------------------------

export const CODE_MAX_ATTEMPTS = 5

export function newVerifyCode(bookingId: string): { code: string; hmac: string } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  return { code, hmac: codeHmac(bookingId, code) }
}

export function codeHmac(bookingId: string, code: string): string {
  return hmac(requireSecret('VERIFY_CODE_SECRET'), `${bookingId}:${code}`)
}

/** Vergleicht einen eingegebenen Code mit dem gespeicherten HMAC (konstante Laufzeit). */
export function codeMatches(bookingId: string, input: string, stored: string | null): boolean {
  const code = input.replace(/\s+/g, '')
  if (!stored || !/^\d{6}$/.test(code)) return false
  return safeEqual(codeHmac(bookingId, code), stored)
}

// --- Verwaltungslink ----------------------------------------------------------------------------

export function manageToken(bookingId: string, version: number): string {
  return hmac(requireSecret('MANAGE_LINK_SECRET'), `${bookingId}:${version}`)
}

/** Prüft einen Verwaltungslink - mit dem aktuellen und (Schlüsselrotation) dem vorherigen Secret. */
export function manageTokenValid(bookingId: string, version: number, token: string): boolean {
  if (!token || token.length > 100) return false
  const keys = [requireSecret('MANAGE_LINK_SECRET'), secret('MANAGE_LINK_SECRET_PREVIOUS')].filter((k): k is string => k !== null)
  // Alle Schlüssel prüfen (kein frühes Ende), damit die Laufzeit nicht verrät, welcher passt.
  let valid = false
  for (const key of keys) if (safeEqual(hmac(key, `${bookingId}:${version}`), token)) valid = true
  return valid
}

/** SHA-256 der IP für die Obergrenze gleichzeitiger Reservierungen (wie in app/lib/throttle.ts). */
export function ipHash(ip: string): string {
  return createHash('sha256').update(`pending-ip\u0000${ip}`).digest('hex')
}
