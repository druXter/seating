// app/lib/throttle.ts
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { prisma } from './prisma'

/**
 * Begrenzt Versuche (Passwort-Raten, Mail-Flut über "Passwort vergessen"). Mehrere Regeln
 * gelten gleichzeitig - schlägt IRGENDEINE an, ist der Versuch gesperrt:
 *
 * - pro IP-Adresse: bremst automatisiertes Durchprobieren vieler Konten (Password
 *   Spraying) von einem Rechner aus.
 * - pro Ziel-E-Mail (unabhängig von der IP): bremst verteiltes Raten gegen EIN Konto
 *   von vielen Adressen aus, das die IP-Regel allein nicht sieht.
 *
 * WICHTIG - reservieren statt nachzählen: Der Versuch wird VOR der Passwortprüfung
 * atomar mitgezählt (reserve). Würde man erst prüfen und danach zählen, könnte jemand
 * viele Anfragen GLEICHZEITIG abschicken: Alle bestünden den Check, bevor der erste
 * Fehlversuch verbucht ist, und er bekäme weit mehr als das Limit an Versuchen. Ein
 * erfolgreicher Login gibt seinen Versuch wieder zurück (refund) bzw. setzt den
 * E-Mail-Zähler zurück - der IP-Zähler wird nie ganz zurückgesetzt, sonst könnte ein
 * Angreifer mit einem eigenen gültigen Konto seinen Zähler beliebig zurückstellen.
 *
 * Bewusst KEINE endgültige Kontosperre: sonst könnte jeder ein fremdes Konto dauerhaft
 * lahmlegen, indem er es absichtlich falsch anmeldet. Die Sperre endet mit dem
 * Zeitfenster (es gleitet nicht - gesperrte Versuche verlängern die Sperre also nicht).
 * Ein Angreifer kann ein Konto damit höchstens phasenweise stören, nicht dauerhaft
 * aussperren - und die Anmeldung über ein verbundenes Tool ist davon ohnehin nicht betroffen.
 *
 * Gespeichert werden nur SHA-256-Hashes von Bereich + Kennung, keine E-Mails/IPs im Klartext.
 */

/**
 * table: 'login' (Standard, LoginThrottle) oder 'booking' (BookingThrottle) - öffentliche
 * Buchungsformulare zählen getrennt, damit sie nie die Anmeldung von Konten beeinflussen.
 */
export type ThrottleRule = { scope: string; identifier: string; limit: number; windowMs: number; table?: 'login' | 'booking' }

/** Beide Tabellen haben dieselbe Form; der Cast fasst die zwei Prisma-Delegates zu einem Typ zusammen. */
function store(rule: Pick<ThrottleRule, 'table'>) {
  return (rule.table === 'booking' ? prisma.bookingThrottle : prisma.loginThrottle) as unknown as typeof prisma.loginThrottle
}

const MINUTE = 60 * 1000

export const LOGIN_WINDOW_MS = 15 * MINUTE

function keyOf(rule: Pick<ThrottleRule, 'scope' | 'identifier'>): string {
  return createHash('sha256').update(`${rule.scope}\u0000${rule.identifier}`).digest('hex')
}

/**
 * Die IP-Adresse des Besuchers hinter unserem Reverse Proxy. X-Forwarded-For darf nur
 * so weit vertraut werden, wie eigene Proxys davorstehen: Jeder Proxy HÄNGT die Adresse,
 * die er sieht, hinten an - der Wert ganz links kann vom Client frei erfunden sein.
 * Deshalb zählt der Eintrag von rechts (TRUST_PROXY_HOPS, Standard 1 = ein Proxy wie
 * nginx-proxy). 0 ignoriert den Header komplett (direkter Zugriff ohne Proxy).
 */
export async function clientIp(): Promise<string> {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10)
  if (!Number.isInteger(hops) || hops < 1) return 'unknown'

  const forwarded = (await headers()).get('x-forwarded-for')
  if (!forwarded) return 'unknown'
  const parts = forwarded.split(',').map(p => p.trim()).filter(Boolean)
  return parts[parts.length - hops] ?? 'unknown'
}

/**
 * Zählt einen Versuch für EINE Regel atomar mit und gibt den Zählerstand danach zurück.
 * Ein abgelaufenes Zeitfenster wird dabei zuerst (ebenfalls atomar, per bedingtem Update)
 * auf ein neues zurückgesetzt.
 */
async function bump(rule: ThrottleRule): Promise<number> {
  const key = keyOf(rule)
  const now = new Date()
  await store(rule).updateMany({
    where: { key, windowStart: { lte: new Date(now.getTime() - rule.windowMs) } },
    data: { count: 0, windowStart: now }
  })
  const row = await store(rule).upsert({
    where: { key },
    create: { key, count: 1, windowStart: now },
    update: { count: { increment: 1 } }
  })
  return row.count
}

/**
 * Reserviert einen Versuch gegen alle Regeln. Gibt false zurück, wenn er gesperrt ist -
 * dann darf KEINE Passwortprüfung mehr stattfinden. Bei der ersten greifenden Regel wird
 * abgebrochen, damit ein durch die IP-Regel Gesperrter nicht zusätzlich den Zähler der
 * Ziel-E-Mail hochtreibt. Die Regeln daher von der gröbsten (IP) zur feinsten (E-Mail) angeben.
 */
export async function reserve(rules: ThrottleRule[]): Promise<boolean> {
  let allowed = true
  for (const rule of rules) {
    if ((await bump(rule)) > rule.limit) {
      allowed = false
      break
    }
  }

  // Abgelaufene Zähler bei Gelegenheit entfernen - die Tabellen sollen nicht unbegrenzt wachsen.
  const stale = { windowStart: { lt: new Date(Date.now() - 24 * 60 * MINUTE) } }
  for (const table of new Set(rules.map(rule => rule.table ?? 'login'))) await store({ table }).deleteMany({ where: stale })
  return allowed
}

/** Gibt einen zuvor reservierten Versuch zurück (erfolgreicher Login). */
export async function refund(rule: ThrottleRule): Promise<void> {
  await store(rule).updateMany({ where: { key: keyOf(rule), count: { gt: 0 } }, data: { count: { decrement: 1 } } })
}

export async function clearFailures(rules: ThrottleRule[]): Promise<void> {
  for (const rule of rules) await store(rule).deleteMany({ where: { key: keyOf(rule) } })
}

/** Regeln für den Passwort-Login: IP-weit großzügiger, pro Konto strenger. */
export function loginRules(ip: string, email: string): { ip: ThrottleRule; email: ThrottleRule } {
  return {
    ip: { scope: 'login:ip', identifier: ip, limit: 20, windowMs: LOGIN_WINDOW_MS },
    email: { scope: 'login:email', identifier: email, limit: 10, windowMs: LOGIN_WINDOW_MS }
  }
}

/** Regeln für "Passwort vergessen" (jede Anfrage zählt): verhindert, dass jemand fremde Postfächer mit Mails flutet. */
export function resetRules(ip: string, email: string): ThrottleRule[] {
  return [
    { scope: 'reset:ip', identifier: ip, limit: 10, windowMs: 60 * MINUTE },
    { scope: 'reset:email', identifier: email, limit: 3, windowMs: 60 * MINUTE }
  ]
}

/** Regel für die Passwort-Abfrage bei "Passwort ändern" (Schutz gegen eine gekaperte Sitzung). */
export function passwordChangeRule(userId: string): ThrottleRule {
  return { scope: 'pwchange:user', identifier: userId, limit: 10, windowMs: LOGIN_WINDOW_MS }
}

/**
 * Öffentliche Buchung (docs/KONZEPT.md Abschnitt 4): Unbestätigte Reservierungen blockieren Tische
 * und lösen Mails aus - deshalb pro IP und pro E-Mail begrenzt.
 */
export function reserveRules(ip: string, email: string): ThrottleRule[] {
  return [
    { scope: 'reserve:ip', identifier: ip, limit: 10, windowMs: 60 * MINUTE, table: 'booking' },
    { scope: 'reserve:email', identifier: email, limit: 5, windowMs: 60 * MINUTE, table: 'booking' }
  ]
}

/** Code-Eingabe: zusätzlich zu den 5 Versuchen pro Buchung (in der Buchung gezählt) pro IP. */
export function codeRules(ip: string): ThrottleRule[] {
  return [{ scope: 'code:ip', identifier: ip, limit: 30, windowMs: 15 * MINUTE, table: 'booking' }]
}

/** "Mail erneut senden" durch Buchende: pro IP und pro Buchung (jede Anfrage verschickt eine Mail). */
export function resendRules(ip: string, bookingId: string): ThrottleRule[] {
  return [
    { scope: 'resend:ip', identifier: ip, limit: 10, windowMs: 60 * MINUTE, table: 'booking' },
    { scope: 'resend:booking', identifier: bookingId, limit: 3, windowMs: 60 * MINUTE, table: 'booking' }
  ]
}
