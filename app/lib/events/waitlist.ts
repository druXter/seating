// app/lib/events/waitlist.ts
import type { Event } from '@prisma/client'
import { after } from 'next/server'
import { prisma } from '../prisma'
import { newVerifyCode, newVerifyToken } from '../booking-tokens'
import { bookingAvailable, sendAlreadyBookedMail, sendConfirmedMail, sendWaitlistVerifyMail } from '../booking-mail'
import { bookingWindow, type WaitlistInput } from './booking-rules'
import { decoyId, tableOf, type ChangeResult, type ManagedBooking } from './booking'
import { audit, emailBlockingWhere, isUniqueViolation, lockEvent, releaseStaleHolds, tableSeatsTaken } from './booking-tx'
import { loadUnitStates } from './store'
import { processMailQueue } from './mail-queue'
import { WAITLIST_VERIFY_HOURS, offerDeadline, planOffers, waitlistChoice } from './waitlist-rules'

/**
 * Warteliste mit Nachrück-Angebot (docs/KONZEPT.md Abschnitt 5):
 *
 * 1. Eintragen (nur wenn kein passender Tisch frei ist), bestätigt per Link/Code wie beim Buchen -
 *    erst dann zählt der Eintrag (booking.ts, markWaitlisted).
 * 2. Wird ein Tisch frei, bekommt der am längsten wartende passende Eintrag ein Angebot: OFFERED mit
 *    Allocation (Unique-Index wie immer die Garantie) bis zur Frist, Mail über die Warteschlange.
 * 3. Annehmen -> CONFIRMED; ablehnen -> Eintrag endet, der Tisch geht weiter; nicht reagiert ->
 *    EXPIRED (Hintergrund-Durchlauf, sweep.ts) und der Tisch geht weiter.
 *
 * Angebote stößt jedes Ereignis an, das einen Tisch frei machen kann (Storno, Tischwechsel, Löschen,
 * Planänderung, Einstellungen, bestätigter Eintrag) - per after() aus den Server Actions - und der
 * Hintergrund-Durchlauf, der auch abgelaufene Reservierungen und Angebote bemerkt.
 */

type FreeTable = { id: string; key: string; label: string; capacity: number; bookable: boolean; free: boolean }

async function tablesOf(eventId: string, now: Date): Promise<FreeTable[]> {
  const [{ states }, units] = await Promise.all([
    loadUnitStates(eventId, now),
    prisma.unit.findMany({ where: { eventId, kind: 'TABLE' }, select: { id: true, key: true, label: true, capacity: true, bookable: true } })
  ])
  return units.map(unit => ({ ...unit, free: states.get(unit.key) === 'free' }))
}

export type JoinResult =
  | { kind: 'joined'; bookingId: string; email: string; expiresAt: Date }
  | { kind: 'free' }
  | { kind: 'too-large' }
  | { kind: 'off' }
  | { kind: 'mail-failed' }

/**
 * Auf die Warteliste setzen (WAITLISTED, unbestätigt, ohne Allocation) und Bestätigungsmail schicken.
 * oneBookingPerEmail zählt Einträge mit; wie beim Buchen antwortet die Seite dann wie bei Erfolg
 * (Schein-id), und die Adresse bekommt einen Hinweis.
 */
export async function joinWaitlist(event: Event, input: WaitlistInput, now = new Date()): Promise<JoinResult> {
  const choice = waitlistChoice(await tablesOf(event.id, now), input.partySize, event.minFillRatio, event.waitlistEnabled)
  if (choice !== 'waitlist') return { kind: choice }

  const expiresAt = new Date(now.getTime() + WAITLIST_VERIFY_HOURS * 60 * 60 * 1000)
  const verify = newVerifyToken()
  const outcome = await prisma.$transaction(async tx => {
    await lockEvent(tx, event.id)
    if (event.oneBookingPerEmail) {
      const existing = await tx.booking.findFirst({ where: { eventId: event.id, email: input.email, ...emailBlockingWhere(now) } })
      if (existing) return { kind: 'duplicate' as const, existing }
    }
    const booking = await tx.booking.create({
      data: {
        eventId: event.id, status: 'WAITLISTED', source: 'PUBLIC', name: input.name, email: input.email, phone: input.phone,
        note: input.note, partySize: input.partySize, expiresAt, verifyTokenHash: verify.hash
      }
    })
    await audit(tx, { eventId: event.id, bookingId: booking.id, actor: 'customer', action: 'waitlist-joined', diff: { partySize: input.partySize } })
    return { kind: 'created' as const, booking }
  })

  if (outcome.kind === 'duplicate') {
    await sendAlreadyBookedMail(event, outcome.existing)
    return { kind: 'joined', bookingId: decoyId(), email: input.email, expiresAt }
  }
  const code = newVerifyCode(outcome.booking.id)
  const booking = await prisma.booking.update({ where: { id: outcome.booking.id }, data: { verifyCodeHmac: code.hmac } })
  if (!(await sendWaitlistVerifyMail(event, booking, verify.token, code.code, expiresAt))) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED', verifyTokenHash: null, verifyCodeHmac: null } })
    await audit(prisma, { eventId: event.id, bookingId: booking.id, actor: 'system', action: 'mail-failed' })
    return { kind: 'mail-failed' }
  }
  return { kind: 'joined', bookingId: booking.id, email: input.email, expiresAt }
}

/**
 * Freie Tische an wartende Einträge anbieten (Zuteilung: waitlist-rules.ts, planOffers). Jedes Angebot
 * in einer eigenen Transaktion; ist der Tisch inzwischen weg oder der Eintrag nicht mehr auf der
 * Liste, wird es übersprungen - der nächste Anstoß holt es nach. Angebote gibt es nur, solange das
 * Event buchbar ist. Gibt die Zahl der Angebote zurück.
 */
export async function offerWaitlist(eventId: string, now = new Date()): Promise<number> {
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event?.waitlistEnabled || !bookingWindow(event, now).open || !bookingAvailable()) return 0
  const entries = await prisma.booking.findMany({
    where: { eventId, status: 'WAITLISTED', emailVerifiedAt: { not: null }, waitlistedAt: { not: null } },
    select: { id: true, partySize: true, waitlistedAt: true }
  })
  if (entries.length === 0) return 0
  const free = (await tablesOf(eventId, now)).filter(table => table.bookable && table.free)
  const offers = planOffers(free, entries.map(e => ({ ...e, waitlistedAt: e.waitlistedAt! })), event.minFillRatio)

  let made = 0
  const expiresAt = offerDeadline(now, event)
  for (const offer of offers) {
    try {
      const done = await prisma.$transaction(async tx => {
        await lockEvent(tx, eventId)
        await releaseStaleHolds(tx, eventId, [offer.table.id], now)
        if (await tableSeatsTaken(tx, eventId, offer.table.key, now)) return false
        const updated = await tx.booking.updateMany({
          where: { id: offer.bookingId, status: 'WAITLISTED', emailVerifiedAt: { not: null } },
          data: { status: 'OFFERED', expiresAt }
        })
        if (updated.count === 0) return false
        await tx.allocation.create({ data: { eventId, unitId: offer.table.id, bookingId: offer.bookingId } })
        const booking = await tx.booking.findUniqueOrThrow({ where: { id: offer.bookingId }, select: { email: true } })
        await audit(tx, { eventId, bookingId: offer.bookingId, actor: 'system', action: 'offered', diff: { table: offer.table.key } })
        if (booking.email) {
          await tx.mailLog.create({ data: { eventId, bookingId: offer.bookingId, type: 'offer', recipient: booking.email, status: 'queued' } })
        }
        return true
      })
      if (done) made++
    } catch (error) {
      // Gleichzeitig vergeben (Unique-Index): Dieses Angebot entfällt, alles andere bleibt.
      if (!isUniqueViolation(error)) throw error
    }
  }
  return made
}

/** Angebote für alle Events mit bestätigten Einträgen (Hintergrund-Durchlauf, Cron). */
export async function offerAllWaitlists(now = new Date()): Promise<number> {
  const events = await prisma.booking.findMany({
    where: { status: 'WAITLISTED', emailVerifiedAt: { not: null }, event: { waitlistEnabled: true, status: 'OPEN' } },
    select: { eventId: true },
    distinct: ['eventId']
  })
  let made = 0
  for (const { eventId } of events) made += await offerWaitlist(eventId, now)
  return made
}

// --- Über den Verwaltungslink --------------------------------------------------------------------

/** Angebot annehmen: OFFERED (Frist noch nicht vorbei) -> CONFIRMED, Bestätigungsmail mit .ics. */
export async function acceptOffer(managed: ManagedBooking, now = new Date()): Promise<ChangeResult> {
  if (managed.status !== 'OFFERED') return { ok: false, errors: ['Dieses Angebot ist nicht mehr offen.'] }
  const updated = await prisma.booking.updateMany({
    where: { id: managed.id, status: 'OFFERED', expiresAt: { gt: now } },
    data: { status: 'CONFIRMED', expiresAt: null }
  })
  if (updated.count === 0) return { ok: false, errors: ['Das Angebot ist leider abgelaufen, der Tisch geht an die nächste Gruppe.'] }
  await audit(prisma, { eventId: managed.eventId, bookingId: managed.id, actor: 'customer', action: 'offer-accepted' })
  const [booking, table] = await Promise.all([prisma.booking.findUniqueOrThrow({ where: { id: managed.id } }), tableOf(managed.id)])
  await sendConfirmedMail(managed.event, booking, table?.label ?? 'Tisch')
  return { ok: true, changed: true }
}

/** Angebot ablehnen: Eintrag endet, der Tisch wird frei (die aufrufende Action bietet ihn weiter an). */
export async function declineOffer(managed: ManagedBooking, now = new Date()): Promise<ChangeResult> {
  if (managed.status !== 'OFFERED') return { ok: false, errors: ['Dieses Angebot ist nicht mehr offen.'] }
  const declined = await prisma.$transaction(async tx => {
    const result = await tx.booking.updateMany({ where: { id: managed.id, status: 'OFFERED' }, data: { status: 'CANCELLED', cancelledAt: now, expiresAt: null } })
    if (result.count === 0) return false
    await tx.allocation.deleteMany({ where: { bookingId: managed.id } })
    await audit(tx, { eventId: managed.eventId, bookingId: managed.id, actor: 'customer', action: 'offer-declined', diff: { table: managed.table?.key ?? null } })
    return true
  })
  return declined ? { ok: true, changed: true } : { ok: false, errors: ['Dieses Angebot ist nicht mehr offen.'] }
}

/** Von der Warteliste austragen (jederzeit, auch nach der Änderungsfrist). */
export async function leaveWaitlist(managed: ManagedBooking, now = new Date()): Promise<ChangeResult> {
  const result = await prisma.booking.updateMany({ where: { id: managed.id, status: 'WAITLISTED' }, data: { status: 'CANCELLED', cancelledAt: now } })
  if (result.count === 0) return { ok: false, errors: ['Du stehst nicht mehr auf der Warteliste.'] }
  await audit(prisma, { eventId: managed.eventId, bookingId: managed.id, actor: 'customer', action: 'waitlist-left' })
  return { ok: true, changed: true }
}

/**
 * Nach der Antwort anbieten: für Server Actions und Route Handler nach jedem Ereignis, das einen Tisch
 * frei machen kann. Ohne wartende Einträge ein Leerlauf.
 */
export function offerAfterResponse(eventId: string) {
  after(async () => {
    await offerWaitlist(eventId)
    await processMailQueue()
  })
}
