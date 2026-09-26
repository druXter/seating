// app/lib/events/booking.ts
import { randomBytes } from 'node:crypto'
import { Prisma, type Booking, type Event } from '@prisma/client'
import { prisma } from '../prisma'
import { CODE_MAX_ATTEMPTS, codeMatches, hashVerifyToken, ipHash, manageTokenValid, newVerifyCode, newVerifyToken } from '../booking-tokens'
import { sendAlreadyBookedMail, sendCancelledMail, sendChangedMail, sendConfirmedMail, sendVerifyMail } from '../booking-mail'
import { HOLDING_STATUSES, tableFits } from './occupancy'
import { MAX_PENDING_PER_IP, canSelfEdit, type ContactFields, type ReservationInput } from './booking-rules'

/**
 * Buchungsabläufe für Buchende (docs/KONZEPT.md Abschnitte 4-6). Die Berechtigung ergibt sich hier
 * nicht aus einem Konto, sondern aus dem Besitz eines Geheimnisses (Verifizierungslink/-code,
 * Verwaltungslink) - jede Funktion prüft es selbst.
 *
 * Doppelbuchung verhindert der Unique-Index Allocation(eventId, unitId), nicht eine vorherige
 * Abfrage: Kommt eine zweite Anfrage gleichzeitig, scheitert ihr Einfügen (P2002).
 */

type Tx = Prisma.TransactionClient

export type Actor = 'customer' | 'system'

async function audit(db: Tx | typeof prisma, entry: { eventId: string; bookingId: string; actor: Actor | string; action: string; diff?: Prisma.InputJsonValue }) {
  await db.auditLog.create({ data: { ...entry, diff: entry.diff ?? {} } })
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * SQLite erlaubt nur einen Schreiber gleichzeitig, sperrt bei einer "deferred" Transaktion aber erst
 * beim ersten Schreiben. Diese Anweisung schreibt als ERSTES - damit sehen die folgenden Prüfungen
 * (eine Buchung pro E-Mail, Obergrenze pro IP) einen festen Stand, und zwei gleichzeitige Anfragen
 * können nicht beide an ihnen vorbeikommen.
 */
async function lockEvent(tx: Tx, eventId: string) {
  await tx.$executeRaw`UPDATE "Event" SET "id" = "id" WHERE "id" = ${eventId}`
}

/** Abgelaufene Holds auf den angegebenen Einheiten auf EXPIRED setzen und ihre Allocations löschen (Konzept Abschnitt 5, Schritt 1). */
async function releaseStaleHolds(tx: Tx, eventId: string, unitIds: string[], now: Date) {
  const stale = await tx.booking.findMany({
    where: { eventId, status: { in: [...HOLDING_STATUSES] }, expiresAt: { lte: now }, allocations: { some: { unitId: { in: unitIds } } } },
    select: { id: true }
  })
  if (stale.length === 0) return
  const ids = stale.map(b => b.id)
  await tx.allocation.deleteMany({ where: { bookingId: { in: ids } } })
  await tx.booking.updateMany({ where: { id: { in: ids } }, data: { status: 'EXPIRED', pendingIpHash: null, verifyTokenHash: null, verifyCodeHmac: null } })
  for (const id of ids) await audit(tx, { eventId, bookingId: id, actor: 'system', action: 'expired' })
}

/** Unauffällige Schein-id für die Antwort, wenn nichts reserviert wurde (siehe reserveTable). */
function decoyId(): string {
  return `c${randomBytes(12).toString('hex').slice(0, 24)}`
}

export type ReserveResult =
  | { kind: 'reserved'; bookingId: string; tableLabel: string; expiresAt: Date; email: string }
  | { kind: 'taken' }
  | { kind: 'unfit'; message: string }
  | { kind: 'limit' }
  | { kind: 'mail-failed' }

/**
 * Reserviert einen Tisch (PENDING, hält ihn bis expiresAt) und schickt die Verifizierungsmail.
 *
 * oneBookingPerEmail: Hat die Adresse schon eine aktive Buchung, wird NICHTS reserviert - die
 * Antwort sieht trotzdem genauso aus wie bei Erfolg (Schein-id), und die Adresse bekommt stattdessen
 * einen Hinweis mit ihrem Verwaltungslink. So verrät die Seite nicht, wer schon gebucht hat.
 *
 * Scheitert der Mailversand, wird die Reservierung sofort wieder freigegeben - sonst hinge ein Tisch
 * an einer Mail, die nie ankommt.
 */
export async function reserveTable(event: Event, input: ReservationInput, ip: string, now = new Date()): Promise<ReserveResult> {
  const unit = await prisma.unit.findUnique({ where: { eventId_key: { eventId: event.id, key: input.unitKey } } })
  if (!unit || unit.kind !== 'TABLE' || !unit.bookable) return { kind: 'unfit', message: 'Diesen Tisch kann man nicht buchen.' }
  if (!tableFits(unit.capacity, input.partySize, event.minFillRatio)) {
    return { kind: 'unfit', message: `${unit.label} passt nicht zu ${input.partySize} ${input.partySize === 1 ? 'Person' : 'Personen'}.` }
  }

  const expiresAt = new Date(now.getTime() + event.pendingTtlMinutes * 60 * 1000)
  const verify = newVerifyToken()
  const pendingIp = ipHash(ip)

  let outcome: { kind: 'created'; booking: Booking } | { kind: 'duplicate'; existing: Booking } | { kind: 'limit' } | { kind: 'taken' }
  try {
    outcome = await prisma.$transaction(async tx => {
      await lockEvent(tx, event.id)
      await releaseStaleHolds(tx, event.id, [unit.id], now)
      // Plätze dieses Tisches (gemischte Belegung): im Modus TABLE nie einzeln belegt, trotzdem prüfen.
      const seatTaken = await tx.allocation.count({
        where: { eventId: event.id, unit: { tableKey: unit.key }, booking: { OR: [{ status: 'CONFIRMED' }, { status: { in: [...HOLDING_STATUSES] }, expiresAt: { gt: now } }] } }
      })
      if (seatTaken > 0) return { kind: 'taken' as const }

      if (event.oneBookingPerEmail) {
        const existing = await tx.booking.findFirst({
          where: { eventId: event.id, email: input.email, OR: [{ status: 'CONFIRMED' }, { status: { in: [...HOLDING_STATUSES] }, expiresAt: { gt: now } }] }
        })
        if (existing) return { kind: 'duplicate' as const, existing }
      }
      const pendingFromIp = await tx.booking.count({ where: { eventId: event.id, pendingIpHash: pendingIp, status: 'PENDING', expiresAt: { gt: now } } })
      if (pendingFromIp >= MAX_PENDING_PER_IP) return { kind: 'limit' as const }

      const booking = await tx.booking.create({
        data: {
          eventId: event.id, status: 'PENDING', source: 'PUBLIC', name: input.name, email: input.email, phone: input.phone,
          note: input.note, partySize: input.partySize, expiresAt, verifyTokenHash: verify.hash, pendingIpHash: pendingIp,
          allocations: { create: { eventId: event.id, unitId: unit.id } }
        }
      })
      await audit(tx, { eventId: event.id, bookingId: booking.id, actor: 'customer', action: 'reserved', diff: { table: unit.key, partySize: input.partySize } })
      return { kind: 'created' as const, booking }
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'taken' }
    throw error
  }

  if (outcome.kind === 'limit' || outcome.kind === 'taken') return outcome
  if (outcome.kind === 'duplicate') {
    await sendAlreadyBookedMail(event, outcome.existing)
    return { kind: 'reserved', bookingId: decoyId(), tableLabel: unit.label, expiresAt, email: input.email }
  }

  const code = newVerifyCode(outcome.booking.id)
  const booking = await prisma.booking.update({ where: { id: outcome.booking.id }, data: { verifyCodeHmac: code.hmac } })
  const sent = await sendVerifyMail(event, booking, unit.label, verify.token, code.code, expiresAt)
  if (!sent) {
    await prisma.$transaction([
      prisma.allocation.deleteMany({ where: { bookingId: booking.id } }),
      prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED', verifyTokenHash: null, verifyCodeHmac: null, pendingIpHash: null } })
    ])
    await audit(prisma, { eventId: event.id, bookingId: booking.id, actor: 'system', action: 'mail-failed' })
    return { kind: 'mail-failed' }
  }
  return { kind: 'reserved', bookingId: booking.id, tableLabel: unit.label, expiresAt, email: input.email }
}

export type ConfirmResult =
  | { kind: 'confirmed'; bookingId: string; manageTokenVersion: number }
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

/** PENDING (mit gültiger Frist) -> CONFIRMED, Geheimnisse löschen, Bestätigungsmail mit .ics. */
async function markConfirmed(booking: Booking, now: Date): Promise<ConfirmResult> {
  const updated = await prisma.booking.updateMany({
    where: { id: booking.id, status: 'PENDING', expiresAt: { gt: now } },
    data: {
      status: 'CONFIRMED', emailVerifiedAt: now, expiresAt: null, verifyTokenHash: null, verifyCodeHmac: null,
      verifyAttempts: 0, pendingIpHash: null
    }
  })
  if (updated.count === 0) return (await prisma.booking.findUnique({ where: { id: booking.id } }))?.status === 'CONFIRMED' ? { kind: 'already' } : { kind: 'expired' }

  await audit(prisma, { eventId: booking.eventId, bookingId: booking.id, actor: 'customer', action: 'confirmed' })
  const [event, table] = await Promise.all([prisma.event.findUniqueOrThrow({ where: { id: booking.eventId } }), tableOf(booking.id)])
  await sendConfirmedMail(event, booking, table?.label ?? 'Tisch')
  return { kind: 'confirmed', bookingId: booking.id, manageTokenVersion: booking.manageTokenVersion }
}

/** Status einer Buchung, deren Link/Code nicht (mehr) passt - für eine verständliche Meldung. */
async function explain(bookingId: string, now: Date): Promise<ConfirmResult> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true, expiresAt: true, verifyAttempts: true } })
  if (!booking) return { kind: 'invalid' }
  if (booking.status === 'CONFIRMED') return { kind: 'already' }
  if (booking.status !== 'PENDING' || !booking.expiresAt || booking.expiresAt <= now) return { kind: 'expired' }
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
    where: { id: bookingId, status: 'PENDING', expiresAt: { gt: now }, verifyAttempts: { lt: CODE_MAX_ATTEMPTS } },
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
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, status: 'PENDING', expiresAt: { gt: now } }, include: { event: true } })
  if (!booking || !booking.expiresAt) return
  const verify = newVerifyToken()
  const code = newVerifyCode(booking.id)
  await prisma.booking.update({ where: { id: booking.id }, data: { verifyTokenHash: verify.hash, verifyCodeHmac: code.hmac, verifyAttempts: 0 } })
  await audit(prisma, { eventId: booking.eventId, bookingId: booking.id, actor: 'customer', action: 'verification-resent' })
  const table = await tableOf(booking.id)
  await sendVerifyMail(booking.event, booking, table?.label ?? 'Tisch', verify.token, code.code, booking.expiresAt)
}

// --- Verwaltungslink ----------------------------------------------------------------------------

export type ManagedBooking = Booking & { event: Event; table: { id: string; key: string; label: string; capacity: number } | null }

/**
 * Buchung zu einem Verwaltungslink - oder null bei falschem Token. Nur bestätigte und stornierte
 * Buchungen haben einen (unbestätigte bekommen den Link erst mit der Bestätigungsmail).
 */
export async function loadManagedBooking(bookingId: string, token: string): Promise<ManagedBooking | null> {
  if (!/^[a-z0-9]{10,40}$/.test(bookingId)) return null
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { event: true } })
  if (!booking || (booking.status !== 'CONFIRMED' && booking.status !== 'CANCELLED')) return null
  if (!manageTokenValid(booking.id, booking.manageTokenVersion, token)) return null
  return { ...booking, table: await tableOf(booking.id) }
}

export type ChangeResult = { ok: true; changed: boolean } | { ok: false; errors: string[] }

/**
 * Änderung über den Verwaltungslink: Kontakt, Personenzahl, Tisch - bis zur Änderungsfrist. Ein
 * Tischwechsel läuft in einer Transaktion (alte Allocation löschen, neue einfügen); ist der neue
 * Tisch inzwischen vergeben, greift wie beim Buchen der Unique-Index.
 */
export async function changeBooking(
  managed: ManagedBooking, change: ContactFields & { partySize: number; unitKey: string }, now = new Date()
): Promise<ChangeResult> {
  const { event } = managed
  if (managed.status !== 'CONFIRMED') return { ok: false, errors: ['Diese Buchung ist storniert.'] }
  if (!canSelfEdit(event, now)) return { ok: false, errors: ['Die Frist für Änderungen ist abgelaufen. Bitte wende dich an die Veranstalter*innen.'] }

  const target = change.unitKey === managed.table?.key
    ? managed.table
    : await prisma.unit.findFirst({ where: { eventId: event.id, key: change.unitKey, kind: 'TABLE', bookable: true } })
  if (!target) return { ok: false, errors: ['Diesen Tisch kann man nicht buchen.'] }
  if (!tableFits(target.capacity, change.partySize, event.minFillRatio)) {
    return { ok: false, errors: [`${target.label} passt nicht zu ${change.partySize} ${change.partySize === 1 ? 'Person' : 'Personen'}.`] }
  }

  const labels: string[] = []
  const diff: Record<string, { from: unknown; to: unknown }> = {}
  const track = (field: string, label: string, from: unknown, to: unknown) => {
    if (from !== to) {
      labels.push(label)
      diff[field] = { from, to }
    }
  }
  track('name', 'Name', managed.name, change.name)
  track('phone', 'Telefon', managed.phone, change.phone)
  track('note', 'Anmerkung', managed.note, change.note)
  track('partySize', 'Personenzahl', managed.partySize, change.partySize)
  track('table', 'Tisch', managed.table?.key ?? null, target.key)
  if (labels.length === 0) return { ok: true, changed: false }

  // Name/Telefon/Anmerkung stehen nicht in der Kalenderdatei - nur Personenzahl und Tisch zählen
  // die SEQUENCE hoch. Eine neue .ics geht trotzdem mit (mit unveränderter Sequenz harmlos).
  const calendarRelevant = 'partySize' in diff || 'table' in diff
  try {
    await prisma.$transaction(async tx => {
      if (target.id !== managed.table?.id) {
        await releaseStaleHolds(tx, event.id, [target.id], now)
        await tx.allocation.deleteMany({ where: { bookingId: managed.id } })
        await tx.allocation.create({ data: { eventId: event.id, unitId: target.id, bookingId: managed.id } })
      }
      await tx.booking.update({
        where: { id: managed.id },
        data: {
          name: change.name, phone: change.phone, note: change.note, partySize: change.partySize,
          ...(calendarRelevant ? { icsSequence: { increment: 1 } } : {})
        }
      })
      await audit(tx, { eventId: event.id, bookingId: managed.id, actor: 'customer', action: 'changed', diff: diff as Prisma.InputJsonValue })
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, errors: [`${target.label} wurde gerade vergeben. Bitte wähle einen anderen Tisch.`] }
    throw error
  }

  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: managed.id } })
  await sendChangedMail(event, updated, target.label, labels)
  return { ok: true, changed: true }
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
  await sendCancelledMail(managed.event, updated, managed.table?.label ?? 'Tisch')
  return { ok: true, changed: true }
}

/** Cron: abgelaufene Holds (PENDING/OFFERED) auf EXPIRED setzen, Tische freigeben. */
export async function expireStaleBookings(now = new Date()): Promise<number> {
  const stale = await prisma.booking.findMany({ where: { status: { in: [...HOLDING_STATUSES] }, expiresAt: { lte: now } }, select: { id: true, eventId: true } })
  for (const booking of stale) {
    await prisma.$transaction(async tx => {
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: { in: [...HOLDING_STATUSES] }, expiresAt: { lte: now } },
        data: { status: 'EXPIRED', pendingIpHash: null, verifyTokenHash: null, verifyCodeHmac: null }
      })
      if (updated.count === 0) return
      await tx.allocation.deleteMany({ where: { bookingId: booking.id } })
      await audit(tx, { eventId: booking.eventId, bookingId: booking.id, actor: 'system', action: 'expired' })
    })
  }
  return stale.length
}
