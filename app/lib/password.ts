// app/lib/password.ts
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * Passwort-Hashing mit scrypt aus node:crypto - keine zusätzliche Abhängigkeit, kein
 * 72-Byte-Limit wie bei bcrypt, und der Speicherbedarf (32 MiB pro Prüfung) macht
 * Angriffe mit Grafikkarten/ASICs deutlich teurer als bcrypt. Parameter: N=2^15, r=8,
 * p=3 (eine der von OWASP für scrypt genannten gleichwertigen Kombinationen).
 *
 * Gespeichertes Format: `scrypt$N$r$p$salt(base64)$hash(base64)`. Die Parameter stehen
 * IM Hash, dadurch können sie später erhöht werden, ohne bestehende Konten zu brechen
 * (verifyPassword meldet dann needsRehash, der Login schreibt beim nächsten Erfolg
 * einen neuen Hash). create-user.js dupliziert bewusst nur diese Erzeugung - dank der
 * eingebetteten Parameter bleibt es kompatibel, auch wenn die Werte hier später steigen.
 */

const N = 2 ** 15
const R = 8
const P = 3
const KEY_LENGTH = 64
const SALT_LENGTH = 16
const MAX_MEMORY = 128 * 1024 * 1024
// Obergrenze für aus der Datenbank gelesene Parameter - nur ein Schutz gegen einen
// manipulierten Hash-String, der die Prüfung unbegrenzt Speicher fressen ließe.
const MAX_N = 2 ** 20

export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 200

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: MAX_MEMORY }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const hash = await derive(password, salt, N, R, P, KEY_LENGTH)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export type PasswordCheck = { ok: boolean; needsRehash: boolean }

export async function verifyPassword(password: string, stored: string): Promise<PasswordCheck> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return { ok: false, needsRehash: false }

  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (![n, r, p].every(Number.isInteger) || n < 2 || n > MAX_N || r < 1 || p < 1) return { ok: false, needsRehash: false }

  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  if (salt.length === 0 || expected.length === 0) return { ok: false, needsRehash: false }

  const actual = await derive(password, salt, n, r, p, expected.length)
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected)
  return { ok, needsRehash: ok && (n < N || r < R || p < P || expected.length < KEY_LENGTH) }
}

let dummyHash: Promise<string> | undefined

/**
 * Führt eine Passwort-Prüfung gegen einen Wegwerf-Hash durch, wenn es zur eingegebenen
 * E-Mail gar kein (passwortfähiges) Konto gibt. Ohne das antwortet der Login bei
 * unbekannten E-Mails messbar schneller als bei bekannten (keine scrypt-Rechnung) und
 * verrät so, welche Adressen registriert sind.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization')
  await verifyPassword(password, await dummyHash)
}

const COMMON_PASSWORDS = new Set([
  'passwort123', 'password123', '1234567890', '0123456789', 'qwertzuiop', 'qwertyuiop',
  'passwort12', 'password12', 'willkommen', 'abcdefghij', 'iloveyou12', 'changeme123'
])

/**
 * Gibt eine Fehlermeldung zurück oder null, wenn das Passwort akzeptabel ist. Bewusst
 * ohne Zeichenklassen-Zwang (das erzeugt nur "Passwort1!") - stattdessen Mindestlänge,
 * Obergrenze gegen Missbrauch als Rechenlast und ein Abgleich gegen die naheliegendsten
 * Fälle (E-Mail selbst, offensichtliche Klassiker).
 */
export function validatePassword(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`
  if (password.length > MAX_PASSWORD_LENGTH) return `Das Passwort darf höchstens ${MAX_PASSWORD_LENGTH} Zeichen lang sein.`

  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return 'Dieses Passwort ist zu naheliegend.'
  if (/^(.)\1+$/.test(password)) return 'Das Passwort darf nicht nur aus einem wiederholten Zeichen bestehen.'
  if (email) {
    const mail = email.toLowerCase()
    if (lower === mail || lower === mail.split('@')[0]) return 'Das Passwort darf nicht deiner E-Mail-Adresse entsprechen.'
  }
  return null
}
