// app/lib/events/booking.ts
import { randomBytes } from 'node:crypto'
import type { Booking, Event, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { CODE_MAX_ATTEMPTS, codeMatches, hashVerifyToken, ipHash, manageTokenValid, newVerifyCode, newVerifyToken } from '../booking-tokens'
import {
  sendAlreadyBookedMail, sendCancelledMail, sendChangedMail, sendConfirmedMail, sendVerifyMail, sendWaitlistConfirmedMail, sendWaitlistVerifyMail
} from '../booking-mail'
import { HOLDING_STATUSES, tableFits } from './occupancy'
import { auditDiff, calendarRelevant, changeLabels, changeRows, diffBooking } from './booking-changes'
import { checkSeats, describePlaces, placeLabelOf, placesOf, setAllocations, type Place } from './places'
import { audit, emailBlockingWhere, isUniqueViolation, lockEvent, queueOfferExpiredMail } from './booking-tx'
import { MAX_PENDING_PER_IP, canSelfEdit, type ContactFields, type ReservationInput } from './booking-rules'

/**
 * Buchungsabläufe für Buchende (docs/KONZEPT.md Abschnitte 4-6). Die Berechtigung ergibt sich hier
 * nicht aus einem Konto, sondern aus dem Besitz eines Geheimnisses (Verifizierungslink/-code,
 * Verwaltungslink) - jede Funktion prüft es selbst.
 *
 * Doppelbuchung verhindert der Unique-Index Allocation(eventId, unitId), nicht eine vorherige
 * Abfrage: Kommt eine zweite Anfrage gleichzeitig, scheitert ihr Einfügen (P2002).
 */

/** Rollt eine Transaktion zurück: ein Ziel ist durch gemischte Belegung gesperrt (setAllocations). */
export class PlacesTaken extends Error {}

/** Unauffällige Schein-id für die Antwort, wenn nichts reserviert wurde (siehe reserveTable). */
export function decoyId(): string {
  return `c${randomBytes(12).toString('hex').slice(0, 24)}`
}

export type ReserveResult =
  | { kind: 'reserved'; bookingId: string; placeLabel: string; expiresAt: Date; email: string }
  | { kind: 'taken' }
  | { kind: 'unfit'; message: string }
  | { kind: 'limit' }
  | { kind: 'mail-failed' }

/**
 * Was eine Buchung belegen will, geprüft gegen die Regeln des Modus: TABLE ein buchbarer, passender
 * Tisch; SEAT 1 bis maxSeatsPerBooking freie, buchbare Plätze (seat-rules.ts). Die Belegung selbst
 * sichert danach der Unique-Index.
 */
async function resolvePlaces(event: Event, unitKeys: string[], partySize: number, now: Date): Promise<{ ok: true; places: Place[]; label: string } | { ok: false; message: string }> {
  if (event.mode === 'SEAT') {
    const check = await checkSeats(event, unitKeys, { maxSeats: event.maxSeatsPerBooking }, now)
    return check.ok ? check : { ok: false, message: check.errors.join(' ') }
  }
  const unit = unitKeys.length === 1 ? await prisma.unit.findUnique({ where: { eventId_key: { eventId: event.id, key: unitKeys[0] } } }) : null
  if (!unit || unit.kind !== 'TABLE' || !unit.bookable) return { ok: false, message: 'Diesen Tisch kann man nicht buchen.' }
  if (!tableFits(unit.capacity, partySize, event.minFillRatio)) {
    return { ok: false, message: `${unit.label} passt nicht zu ${partySize} ${partySize === 1 ? 'Person' : 'Personen'}.` }
  }
  return { ok: true, places: [unit], label: unit.label }
}

/** Für AuditLog.diff: der Tisch als stabiler key, Plätze als Kurzbeschreibung. */
function placesDiff(event: Pick<Event, 'mode'>, places: readonly Place[], label: string) {
  return event.mode === 'SEAT' ? { seats: label } : { table: places[0]?.key ?? null }
}

/**
 * Reserviert einen Tisch bzw. Plätze (PENDING, hält sie bis expiresAt) und schickt die Verifizierungsmail.
 *
 * oneBookingPerEmail: Hat die Adresse schon eine aktive Buchung, wird NICHTS reserviert - die
 * Antwort sieht trotzdem genauso aus wie bei Erfolg (Schein-id), und die Adresse bekommt stattdessen
 * einen Hinweis mit ihrem Verwaltungslink. So verrät die Seite nicht, wer schon gebucht hat.
 *
 * Scheitert der Mailversand, wird die Reservierung sofort wieder freigegeben - sonst hinge ein Tisch
 * an einer Mail, die nie ankommt.
 */
export async function reservePlaces(event: Event, input: ReservationInput, ip: string, now = new Date()): Promise<ReserveResult> {
  const resolved = await resolvePlaces(event, input.unitKeys, input.partySize, now)
  if (!resolved.ok) return { kind: 'unfit', message: resolved.message }
  const { places, label } = resolved
  const partySize = event.mode === 'SEAT' ? places.length : input.partySize

  const expiresAt = new Date(now.getTime() + event.pendingTtlMinutes * 60 * 1000)
  const verify = newVerifyToken()
  const pendingIp = ipHash(ip)

  let outcome: { kind: 'created'; booking: Booking } | { kind: 'duplicate'; existing: Booking } | { kind: 'limit' }
  try {
    outcome = await prisma.$transaction(async tx => {
      await lockEvent(tx, event.id)
      if (event.oneBookingPerEmail) {
        const existing = await tx.booking.findFirst({ where: { eventId: event.id, email: input.email, ...emailBlockingWhere(now) } })
        if (existing) return { kind: 'duplicate' as const, existing }
      }
      const pendingFromIp = await tx.booking.count({ where: { eventId: event.id, pendingIpHash: pendingIp, status: 'PENDING', expiresAt: { gt: now } } })
      if (pendingFromIp >= MAX_PENDING_PER_IP) return { kind: 'limit' as const }

      const booking = await tx.booking.create({
        data: {
          eventId: event.id, status: 'PENDING', source: 'PUBLIC', name: input.name, email: input.email, phone: input.phone,
          note: input.note, partySize, expiresAt, verifyTokenHash: verify.hash, pendingIpHash: pendingIp
        }
      })
      // Belegung erst nach den Prüfungen: gemischte Belegung und Unique-Index (Konzept Abschnitt 5).
      if (!(await setAllocations(tx, event.id, booking.id, places, now))) throw new PlacesTaken()
      await audit(tx, { eventId: event.id, bookingId: booking.id, actor: 'customer', action: 'reserved', diff: { ...placesDiff(event, places, label), partySize } })
      return { kind: 'created' as const, booking }
    })
  } catch (error) {
    if (isUniqueViolation(error) || error instanceof PlacesTaken) return { kind: 'taken' }
    throw error
  }

  if (outcome.kind === 'limit') return outcome
  if (outcome.kind === 'duplicate') {
    await sendAlreadyBookedMail(event, outcome.existing)
    return { kind: 'reserved', bookingId: decoyId(), placeLabel: label, expiresAt, email: input.email }
  }

  const code = newVerifyCode(outcome.booking.id)
  const booking = await prisma.booking.update({ where: { id: outcome.booking.id }, data: { verifyCodeHmac: code.hmac } })
  const sent = await sendVerifyMail(event, booking, label, verify.token, code.code, expiresAt)
  if (!sent) {
    await prisma.$transaction([
      prisma.allocation.deleteMany({ where: { bookingId: booking.id } }),
      prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED', verifyTokenHash: null, verifyCodeHmac: null, pendingIpHash: null } })
    ])
    await audit(prisma, { eventId: event.id, bookingId: booking.id, actor: 'system', action: 'mail-failed' })
    return { kind: 'mail-failed' }
  }
  return { kind: 'reserved', bookingId: booking.id, placeLabel: label, expiresAt, email: input.email }
}

export type ConfirmResult =
  | { kind: 'confirmed'; bookingId: string; manageTokenVersion: number }
  | { kind: 'waitlisted'; bookingId: string; eventId: string; manageTokenVersion: number }
  | { kind: 'already' }
  | { kind: 'expired' }
  | { kind: 'wrong-code' }
  | { kind: 'locked' }
  | { kind: 'invalid' }

/** Tisch-Label der (einzigen) Allocation einer Buchung im Modus TABLE. */
export async function tableOf(bookingId: string): Promise<{ id: string; key: string; label: string; capacity: number } | null> {
  const allocation = await prisma.allocation.findFirst({ where: { bookingId }, select: { unit: { select: { id: true, key: true, label: true, capacity: true } } } })
  return allocation?.unit ?? null
}

/**
 * Was sich per Link oder Code bestätigen lässt: eine Reservierung (PENDING) oder ein noch
 * unbestätigter Eintrag auf der Warteliste - jeweils nur innerhalb der Frist.
 */
function verifiable(now: Date): Prisma.BookingWhereInput {
  return { expiresAt: { gt: now }, OR: [{ status: 'PENDING' }, { status: 'WAITLISTED', emailVerifiedAt: null }] }
}

/**
 * Eintrag auf der Warteliste bestätigt: ab jetzt zählt er (waitlistedAt bestimmt die Reihenfolge).
 * Ein Angebot stößt die aufrufende Server Action an (app/lib/events/waitlist.ts).
 */
async function markWaitlisted(booking: Booking, now: Date): Promise<ConfirmResult> {
  const updated = await prisma.booking.updateMany({
    where: { id: booking.id, status: 'WAITLISTED', emailVerifiedAt: null, expiresAt: { gt: now } },
    data: { emailVerifiedAt: now, waitlistedAt: now, expiresAt: null, verifyTokenHash: null, verifyCodeHmac: null, verifyAttempts: 0, pendingIpHash: null }
  })
  if (updated.count === 0) return explain(booking.id, now)
  await audit(prisma, { eventId: booking.eventId, bookingId: booking.id, actor: 'customer', action: 'waitlist-confirmed' })
  const event = await prisma.event.findUniqueOrThrow({ where: { id: booking.eventId } })
  await sendWaitlistConfirmedMail(event, booking)
  return { kind: 'waitlisted', bookingId: booking.id, eventId: booking.eventId, manageTokenVersion: booking.manageTokenVersion }
}

/** PENDING (mit gültiger Frist) -> CONFIRMED, Geheimnisse löschen, Bestätigungsmail mit .ics. */
async function markConfirmed(booking: Booking, now: Date): Promise<ConfirmResult> {
  if (booking.status === 'WAITLISTED') return markWaitlisted(booking, now)
  const updated = await prisma.booking.updateMany({
    where: { id: booking.id, status: 'PENDING', expiresAt: { gt: now } },
    data: {
      status: 'CONFIRMED', emailVerifiedAt: now, expiresAt: null, verifyTokenHash: null, verifyCodeHmac: null,
      verifyAttempts: 0, pendingIpHash: null
    }
  })
  if (updated.count === 0) return (await prisma.booking.findUnique({ where: { id: booking.id } }))?.status === 'CONFIRMED' ? { kind: 'already' } : { kind: 'expired' }

  await audit(prisma, { eventId: booking.eventId, bookingId: booking.id, actor: 'customer', action: 'confirmed' })
  const [event, label] = await Promise.all([prisma.event.findUniqueOrThrow({ where: { id: booking.eventId } }), placeLabelOf(booking.id)])
  await sendConfirmedMail(event, booking, label)
  return { kind: 'confirmed', bookingId: booking.id, manageTokenVersion: booking.manageTokenVersion }
}

/** Status einer Buchung, deren Link/Code nicht (mehr) passt - für eine verständliche Meldung. */
async function explain(bookingId: string, now: Date): Promise<ConfirmResult> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true, expiresAt: true, verifyAttempts: true, emailVerifiedAt: true } })
  if (!booking) return { kind: 'invalid' }
  if (booking.status === 'CONFIRMED' || booking.status === 'OFFERED' || (booking.status === 'WAITLISTED' && booking.emailVerifiedAt)) return { kind: 'already' }
  const open = booking.status === 'PENDING' || booking.status === 'WAITLISTED'
  if (!open || !booking.expiresAt || booking.expiresAt <= now) return { kind: 'expired' }
  if (booking.verifyAttempts >= CODE_MAX_ATTEMPTS) return { kind: 'locked' }
  return { kind: 'invalid' }
}

/** Bestätigung über den Link aus der Mail (per POST von der Seite /verify/<id>/<token>). */
export async function confirmByToken(bookingId: string, token: string, now = new Date()): Promise<ConfirmResult> {
  const booking = token ? await prisma.booking.findFirst({ where: { id: bookingId, verifyTokenHash: hashVerifyToken(token) } }) : null
  if (!booking) return explainLink(bookingId, now)
  return markConfirmed(booking, now)
}

/**
 * Ein nicht (mehr) passender Link verrät nur, ob die Buchung schon bestätigt ist - und das auch nur
 * zusammen mit ihrer id, die ohnehin nur in der Mail stand.
 */
async function explainLink(bookingId: string, now: Date): Promise<ConfirmResult> {
  const result = await explain(bookingId, now)
  return result.kind === 'already' ? result : { kind: 'invalid' }
}

/** Nur lesen: Buchung zu einem Verifizierungslink (für die Seite mit dem Bestätigen-Button). */
export async function bookingForVerifyLink(bookingId: string, token: string) {
  if (!token || token.length > 100) return null
  return prisma.booking.findFirst({ where: { id: bookingId, verifyTokenHash: hashVerifyToken(token) }, include: { event: true } })
}

/**
 * Bestätigung per 6-stelligem Code. Der Versuch wird VOR dem Vergleich atomar mitgezählt (bedingtes
 * Update) - gleichzeitige Anfragen bekommen so zusammen höchstens CODE_MAX_ATTEMPTS Versuche.
 */
export async function confirmByCode(bookingId: string, input: string, now = new Date()): Promise<ConfirmResult> {
  const counted = await prisma.booking.updateMany({
    where: { id: bookingId, ...verifiable(now), verifyAttempts: { lt: CODE_MAX_ATTEMPTS } },
    data: { verifyAttempts: { increment: 1 } }
  })
  if (counted.count === 0) {
    const reason = await explain(bookingId, now)
    // Eine unbekannte id sieht aus wie ein falscher Code (Schein-id aus reserveTable).
    return reason.kind === 'invalid' ? { kind: 'wrong-code' } : reason
  }
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })
  // Bewusst ohne "noch N Versuche": Bei einer Schein-id (siehe reserveTable) ließe sich sonst am
  // gleichbleibenden Zähler erkennen, dass nichts reserviert wurde.
  if (!codeMatches(booking.id, input, booking.verifyCodeHmac)) {
    return booking.verifyAttempts < CODE_MAX_ATTEMPTS ? { kind: 'wrong-code' } : { kind: 'locked' }
  }
  return markConfirmed(booking, now)
}

/**
 * Neuer Link und Code an dieselbe Adresse, alter wird ungültig, Versuchszähler auf 0. Verlängert den
 * Verfall NICHT (sonst ließe sich ein Tisch beliebig lange blockieren). Antwortet immer gleich.
 */
export async function resendVerification(bookingId: string, now = new Date()): Promise<void> {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, ...verifiable(now) }, include: { event: true } })
  if (!booking || !booking.expiresAt) return
  const verify = newVerifyToken()
  const code = newVerifyCode(booking.id)
  await prisma.booking.update({ where: { id: booking.id }, data: { verifyTokenHash: verify.hash, verifyCodeHmac: code.hmac, verifyAttempts: 0 } })
  await audit(prisma, { eventId: booking.eventId, bookingId: booking.id, actor: 'customer', action: 'verification-resent' })
  if (booking.status === 'WAITLISTED') {
    await sendWaitlistVerifyMail(booking.event, booking, verify.token, code.code, booking.expiresAt)
    return
  }
  await sendVerifyMail(booking.event, booking, await placeLabelOf(booking.id), verify.token, code.code, booking.expiresAt)
}

// --- Verwaltungslink ----------------------------------------------------------------------------

/** table: der Tisch (Modus TABLE), places: alle belegten Einheiten, placeLabel: deren Kurzbeschreibung. */
export type ManagedBooking = Booking & { event: Event; table: Place | null; places: Place[]; placeLabel: string }

/**
 * Buchung zu einem Verwaltungslink - oder null bei falschem Token. Den Link bekommt man erst mit der
 * Bestätigung (Buchung oder Eintrag auf der Warteliste); unbestätigte Reservierungen und Einträge
 * haben also keinen. Beendete Einträge der Warteliste (abgelehnt, verfallen) zeigen ihren Stand.
 */
export async function loadManagedBooking(bookingId: string, token: string): Promise<ManagedBooking | null> {
  if (!/^[a-z0-9]{10,40}$/.test(bookingId)) return null
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { event: true } })
  if (!booking) return null
  const linked = booking.status === 'CONFIRMED' || booking.status === 'CANCELLED' || booking.status === 'OFFERED'
    || ((booking.status === 'WAITLISTED' || booking.status === 'EXPIRED') && booking.waitlistedAt !== null)
  if (!linked) return null
  if (!manageTokenValid(booking.id, booking.manageTokenVersion, token)) return null
  const places = await placesOf(booking.id)
  return { ...booking, table: places.find(p => p.kind === 'TABLE') ?? null, places, placeLabel: describePlaces(places) }
}

export type ChangeResult = { ok: true; changed: boolean } | { ok: false; errors: string[] }

/**
 * Änderung über den Verwaltungslink: Kontakt, Personenzahl, Tisch - bis zur Änderungsfrist. Ein
 * Tischwechsel läuft in einer Transaktion (alte Allocation löschen, neue einfügen); ist der neue
 * Tisch inzwischen vergeben, greift wie beim Buchen der Unique-Index.
 */
export async function changeBooking(
  managed: ManagedBooking, change: ContactFields & { partySize: number; unitKeys: string[] }, now = new Date()
): Promise<ChangeResult> {
  const { event } = managed
  if (managed.status !== 'CONFIRMED') return { ok: false, errors: ['Diese Buchung ist storniert.'] }
  if (!canSelfEdit(event, now)) return { ok: false, errors: ['Die Frist für Änderungen ist abgelaufen. Bitte wende dich an die Veranstalter*innen.'] }

  const target = await changeTarget(managed, change.unitKeys, change.partySize, now)
  if (!target.ok) return { ok: false, errors: target.errors }
  const partySize = event.mode === 'SEAT' ? target.places.length : change.partySize

  const changes = diffBooking(
    { name: managed.name, phone: managed.phone, note: managed.note, partySize: managed.partySize, tableKey: managed.table?.key ?? null, ...seatSnapshot(event, managed.placeLabel) },
    { ...change, partySize, tableKey: event.mode === 'SEAT' ? null : target.places[0].key, ...seatSnapshot(event, target.label) }
  )
  if (changes.length === 0) return { ok: true, changed: false }

  // Eine neue .ics geht immer mit, die SEQUENCE steigt aber nur bei Personenzahl, Tisch oder Plätzen.
  const taken = event.mode === 'SEAT' ? 'Mindestens einer der Plätze wurde gerade vergeben. Bitte wähle neu.' : `${target.label} wurde gerade vergeben. Bitte wähle einen anderen Tisch.`
  try {
    await prisma.$transaction(async tx => {
      if (!samePlaces(managed.places, target.places) && !(await setAllocations(tx, event.id, managed.id, target.places, now))) throw new PlacesTaken()
      await tx.booking.update({
        where: { id: managed.id },
        data: {
          name: change.name, phone: change.phone, note: change.note, partySize,
          ...(calendarRelevant(changes) ? { icsSequence: { increment: 1 } } : {})
        }
      })
      await audit(tx, { eventId: event.id, bookingId: managed.id, actor: 'customer', action: 'changed', diff: auditDiff(changes) })
    })
  } catch (error) {
    if (isUniqueViolation(error) || error instanceof PlacesTaken) return { ok: false, errors: [taken] }
    throw error
  }

  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: managed.id } })
  const labelOf = (key: string) => key === target.places[0]?.key ? target.places[0].label : key === managed.table?.key ? managed.table.label : key
  await sendChangedMail(event, updated, target.label, changeLabels(changes), changeRows(changes, labelOf))
  return { ok: true, changed: true }
}

/** Plätze als Teil des Vergleichs nur im Modus SEAT. */
export function seatSnapshot(event: Pick<Event, 'mode'>, label: string): { seats?: string } {
  return event.mode === 'SEAT' ? { seats: label } : {}
}

export function samePlaces(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  const ids = new Set(a.map(p => p.id))
  return a.length === b.length && b.every(p => ids.has(p.id))
}

/**
 * Neues Ziel einer Änderung durch die Kund*in: TABLE der eigene oder ein freier, buchbarer, passender
 * Tisch; SEAT eigene und freie Plätze bis maxSeatsPerBooking.
 */
async function changeTarget(managed: ManagedBooking, unitKeys: string[], partySize: number, now: Date): Promise<{ ok: true; places: Place[]; label: string } | { ok: false; errors: string[] }> {
  const { event } = managed
  if (event.mode === 'SEAT') return checkSeats(event, unitKeys, { ownBookingId: managed.id, maxSeats: event.maxSeatsPerBooking }, now)
  const key = unitKeys[0]
  const target = key === managed.table?.key
    ? managed.table
    : await prisma.unit.findFirst({ where: { eventId: event.id, key, kind: 'TABLE', bookable: true }, select: { id: true, key: true, label: true, kind: true, capacity: true, tableKey: true } })
  if (!target || unitKeys.length !== 1) return { ok: false, errors: ['Diesen Tisch kann man nicht buchen.'] }
  if (!tableFits(target.capacity, partySize, event.minFillRatio)) {
    return { ok: false, errors: [`${target.label} passt nicht zu ${partySize} ${partySize === 1 ? 'Person' : 'Personen'}.`] }
  }
  return { ok: true, places: [target], label: target.label }
}

/** Storno über den Verwaltungslink (bis zur Änderungsfrist): Tisch frei, Mail mit .ics (CANCEL). */
export async function cancelBooking(managed: ManagedBooking, now = new Date()): Promise<ChangeResult> {
  if (managed.status !== 'CONFIRMED') return { ok: false, errors: ['Diese Buchung ist bereits storniert.'] }
  if (!canSelfEdit(managed.event, now)) return { ok: false, errors: ['Die Frist für Stornierungen ist abgelaufen. Bitte wende dich an die Veranstalter*innen.'] }

  const cancelled = await prisma.$transaction(async tx => {
    const result = await tx.booking.updateMany({
      where: { id: managed.id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED', cancelledAt: now, icsSequence: { increment: 1 } }
    })
    if (result.count === 0) return false
    await tx.allocation.deleteMany({ where: { bookingId: managed.id } })
    await audit(tx, { eventId: managed.eventId, bookingId: managed.id, actor: 'customer', action: 'cancelled', diff: { table: managed.table?.key ?? null } })
    return true
  })
  if (!cancelled) return { ok: false, errors: ['Diese Buchung ist bereits storniert.'] }

  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: managed.id } })
  await sendCancelledMail(managed.event, updated, managed.placeLabel)
  return { ok: true, changed: true }
}

/**
 * Hintergrund-Durchlauf und Cron: abgelaufene Holds (PENDING/OFFERED) und unbestätigte Einträge der
 * Warteliste auf EXPIRED setzen, Tische freigeben. Ein verfallenes Angebot bekommt die Mail
 * "Angebot verfallen" (Warteschlange). Gibt die betroffenen Events zurück - dort kann jetzt ein
 * Angebot aus der Warteliste folgen.
 */
export async function expireStaleBookings(now = new Date()): Promise<string[]> {
  const expiring = [...HOLDING_STATUSES, 'WAITLISTED' as const]
  const stale = await prisma.booking.findMany({
    where: { status: { in: expiring }, expiresAt: { lte: now } },
    select: { id: true, eventId: true, status: true, email: true }
  })
  const events = new Set<string>()
  for (const booking of stale) {
    await prisma.$transaction(async tx => {
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status, expiresAt: { lte: now } },
        data: { status: 'EXPIRED', pendingIpHash: null, verifyTokenHash: null, verifyCodeHmac: null }
      })
      if (updated.count === 0) return
      await tx.allocation.deleteMany({ where: { bookingId: booking.id } })
      await audit(tx, { eventId: booking.eventId, bookingId: booking.id, actor: 'system', action: 'expired' })
      if (booking.status === 'OFFERED') await queueOfferExpiredMail(tx, booking)
      events.add(booking.eventId)
    })
  }
  return [...events]
}
