// app/lib/rsvp/booking.ts
import type { Booking, Event } from '@prisma/client'
import { prisma } from '../prisma'
import { isMailConfigured } from '../mail'
import { sendCancelledMail, sendConfirmedMail } from '../booking-mail'
import { tableFits } from '../events/occupancy'
import { checkSeats, describePlaces, placeLabelOf, setAllocations, type Place } from '../events/places'
import { audit, isUniqueViolation, lockEvent, type Actor } from '../events/booking-tx'
import { PlacesTaken } from '../events/booking'
import { rsvpSecret, seatingOrigin } from './config'
import { verifyMessage, type Message } from './token'
import { externalRefOf, partySizeOf } from './rules'

/**
 * Platzwahl über eine Zusage aus rsvp-app (Zugang RSVP, docs/KONZEPT.md Abschnitt 9 A): rsvp-app stellt
 * pro Klick auf "Sitzplatz wählen" einen kurz gültigen, signierten Link aus (token.ts, seat-link). Die
 * Buchung entsteht erst per POST mit diesem Link - sofort bestätigt (die Zusage IST die Bestätigung),
 * source RSVP, Personenzahl fest aus rsvp-app. Höchstens eine aktive Buchung je Zusage (externalRef),
 * geprüft in derselben Transaktion wie das Anlegen; Doppelbelegung verhindert wie immer der Unique-Index.
 */

export type SeatLink = Message<'seat-link'>

/** Das Event, auf das ein Link zeigt, muss genau so verknüpft sein - beide Seiten haben zugestimmt. */
function linkedTo(event: Pick<Event, 'id' | 'rsvpEventId'>, message: { seatingEventId: string; rsvpEventId: string }): boolean {
  return event.rsvpEventId !== null && message.seatingEventId === event.id && message.rsvpEventId === event.rsvpEventId
}

/** Prüft einen Link zur Platzwahl für genau dieses Event (Signatur, Art, Empfänger, Frist, Verknüpfung, Zugang). */
export function readSeatLink(token: string, event: Pick<Event, 'id' | 'rsvpEventId' | 'access' | 'mode'>, now = new Date()): SeatLink | null {
  const secret = rsvpSecret()
  if (!secret || event.access !== 'RSVP' || event.mode === 'ASSIGNED') return null
  const message = verifyMessage(token, 'seat-link', { secret, audience: seatingOrigin(), now })
  return message && linkedTo(event, message) ? message : null
}

/** Die aktive (bestätigte) Buchung zu einer Zusage, falls es eine gibt. */
export function activeRsvpBooking(eventId: string, rsvpEventId: string, rsvpId: string) {
  return prisma.booking.findFirst({ where: { eventId, externalRef: externalRefOf(rsvpEventId, rsvpId), status: 'CONFIRMED' } })
}

export type RsvpBookResult =
  | { kind: 'booked' | 'existing'; booking: Booking }
  | { kind: 'taken' }
  | { kind: 'unfit'; message: string }

/**
 * Ziel prüfen: TABLE ein buchbarer Tisch, zu dem die Gruppe passt (inkl. Mindestbelegung); SEAT genau so
 * viele freie, buchbare Plätze, wie die Zusage Personen hat.
 */
async function resolve(event: Event, unitKeys: string[], partySize: number, now: Date): Promise<{ ok: true; places: Place[]; label: string } | { ok: false; message: string }> {
  if (event.mode === 'SEAT') {
    if (unitKeys.length !== partySize) return { ok: false, message: `Bitte wähle genau ${partySize} ${partySize === 1 ? 'Platz' : 'Plätze'} – so viele Personen hat eure Zusage.` }
    const check = await checkSeats(event, unitKeys, { maxSeats: partySize }, now)
    return check.ok ? check : { ok: false, message: check.errors.join(' ') }
  }
  const unit = unitKeys.length === 1 ? await prisma.unit.findUnique({ where: { eventId_key: { eventId: event.id, key: unitKeys[0] } } }) : null
  if (!unit || unit.kind !== 'TABLE' || !unit.bookable) return { ok: false, message: 'Diesen Tisch kann man nicht buchen.' }
  if (!tableFits(unit.capacity, partySize, event.minFillRatio)) return { ok: false, message: `${unit.label} passt nicht zu ${partySize} ${partySize === 1 ? 'Person' : 'Personen'}.` }
  return { ok: true, places: [unit], label: unit.label }
}

export async function bookViaRsvp(event: Event, link: SeatLink, unitKeys: string[], now = new Date()): Promise<RsvpBookResult> {
  const partySize = partySizeOf(link)
  const externalRef = externalRefOf(link.rsvpEventId, link.rsvpId)
  const existing = await activeRsvpBooking(event.id, link.rsvpEventId, link.rsvpId)
  if (existing) return { kind: 'existing', booking: existing }

  const resolved = await resolve(event, unitKeys, partySize, now)
  if (!resolved.ok) return { kind: 'unfit', message: resolved.message }
  const { places, label } = resolved

  let outcome: RsvpBookResult
  try {
    outcome = await prisma.$transaction(async (tx): Promise<RsvpBookResult> => {
      await lockEvent(tx, event.id)
      // Nach der Sperre erneut: ein zweiter, gleichzeitiger Klick mit demselben Link bucht nicht doppelt.
      const again = await tx.booking.findFirst({ where: { eventId: event.id, externalRef, status: 'CONFIRMED' } })
      if (again) return { kind: 'existing', booking: again }
      const booking = await tx.booking.create({
        data: {
          eventId: event.id, status: 'CONFIRMED', source: 'RSVP', name: link.name, email: link.email, partySize,
          externalRef, rsvpPartySize: partySize, rsvpSyncedAt: new Date(link.iat * 1000)
        }
      })
      if (!(await setAllocations(tx, event.id, booking.id, places, now))) throw new PlacesTaken()
      await audit(tx, {
        eventId: event.id, bookingId: booking.id, actor: 'customer', action: 'rsvp-booked',
        diff: { ...(event.mode === 'SEAT' ? { seats: label } : { table: places[0].key }), partySize }
      })
      return { kind: 'booked', booking }
    })
  } catch (error) {
    if (isUniqueViolation(error) || error instanceof PlacesTaken) return { kind: 'taken' }
    throw error
  }
  if (outcome.kind === 'booked' && outcome.booking.email && isMailConfigured()) await sendConfirmedMail(event, outcome.booking, label)
  return outcome
}

// --- Meldungen aus rsvp-app ---------------------------------------------------------------------

/**
 * Buchung aus einer Zusage stornieren (Absage in rsvp-app, Abgleich): Plätze frei, Storno-Mail mit
 * .ics (CANCEL), wenn es eine Adresse gibt. actor "rsvp" im Verlauf.
 */
export async function cancelRsvpBooking(event: Event, booking: Pick<Booking, 'id' | 'status'>, reason: string, now = new Date()): Promise<boolean> {
  const placeLabel = await placeLabelOf(booking.id)
  const cancelled = await prisma.$transaction(async tx => {
    const result = await tx.booking.updateMany({
      where: { id: booking.id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED', cancelledAt: now, icsSequence: { increment: 1 } }
    })
    if (result.count === 0) return false
    await tx.allocation.deleteMany({ where: { bookingId: booking.id } })
    await audit(tx, { eventId: event.id, bookingId: booking.id, actor: 'rsvp', action: 'rsvp-cancelled', diff: { reason } })
    return true
  })
  if (!cancelled) return false
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  if (updated.email && updated.source === 'RSVP' && event.mode !== 'ASSIGNED' && isMailConfigured()) await sendCancelledMail(event, updated, placeLabel)
  return true
}

/**
 * Stand einer Zusage übernehmen (Webhook, Abgleich): Name, Adresse, Personenzahl laut rsvp-app. Die
 * Plätze bleiben - weicht die Personenzahl ab, zeigen Verwaltungsseite und Admin-Bereich einen Hinweis.
 */
export async function updateRsvpBooking(booking: Booking, guest: { name: string; email: string | null; companions: readonly (string | null)[] }, syncedAt: Date | null, actor: Actor = 'rsvp') {
  const partySize = partySizeOf(guest)
  const diff: Record<string, { from: string | number | null; to: string | number | null }> = {}
  if (guest.name && guest.name !== booking.name) diff.name = { from: booking.name, to: guest.name }
  if (partySize !== (booking.rsvpPartySize ?? booking.partySize)) diff.partySize = { from: booking.rsvpPartySize ?? booking.partySize, to: partySize }
  if (guest.email !== booking.email) diff.email = { from: booking.email, to: guest.email }
  await prisma.booking.update({
    where: { id: booking.id },
    data: { name: guest.name || booking.name, email: guest.email, rsvpPartySize: partySize, ...(syncedAt ? { rsvpSyncedAt: syncedAt } : {}) }
  })
  if (Object.keys(diff).length > 0) await audit(prisma, { eventId: booking.eventId, bookingId: booking.id, actor, action: 'rsvp-updated', diff })
}

export type ChangeOutcome = 'ignored' | 'stale' | 'noted' | 'cancelled' | 'updated'

/**
 * Webhook "Zusage geändert" (rsvp-app -> Seating, token.ts rsvp-change). Nur für ein Event, das genau
 * so verknüpft ist. Sitzordnung (ASSIGNED): nichts passiert von selbst, die Sitzordnung zeigt "bitte
 * abgleichen". Platzwahl (TABLE/SEAT): Absage -> Storno, sonst Stand übernehmen. Ältere Meldungen als
 * die zuletzt angewandte (iat) werden ignoriert.
 */
export async function applyRsvpChange(message: Message<'rsvp-change'>, now = new Date()): Promise<ChangeOutcome> {
  const event = await prisma.event.findUnique({ where: { id: message.seatingEventId } })
  if (!event || !linkedTo(event, message)) return 'ignored'
  if (event.mode === 'ASSIGNED') {
    await prisma.event.update({ where: { id: event.id }, data: { rsvpChangedAt: now } })
    return 'noted'
  }
  const booking = await activeRsvpBooking(event.id, message.rsvpEventId, message.rsvpId)
  if (!booking) return 'ignored'
  const sentAt = new Date(message.iat * 1000)
  // Strikt älter: iat hat nur Sekunden - eine Meldung aus derselben Sekunde wie die Buchung gilt noch.
  if (booking.rsvpSyncedAt && sentAt < booking.rsvpSyncedAt) return 'stale'
  if (!message.attending) {
    await prisma.booking.update({ where: { id: booking.id }, data: { rsvpSyncedAt: sentAt } })
    return (await cancelRsvpBooking(event, booking, 'Absage in rsvp-app', now)) ? 'cancelled' : 'ignored'
  }
  await updateRsvpBooking(booking, message, sentAt)
  return 'updated'
}

/** Kurzbeschreibung der Plätze je Zusage (für die Rückmeldung an rsvp-app). */
export function placementLabel(places: readonly { label: string; kind: 'TABLE' | 'SEAT' }[]): string {
  return describePlaces(places)
}
