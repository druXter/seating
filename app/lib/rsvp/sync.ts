// app/lib/rsvp/sync.ts
import type { Event, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { audit } from '../events/booking-tx'
import { rsvpAppOrigin, rsvpSecret, seatingOrigin } from './config'
import { createMessage, verifyMessage } from './token'
import { cancelRsvpBooking, updateRsvpBooking } from './booking'
import {
  diffBookings, diffParties, externalRefOf, isEmptyChange, partyChange, partySizeOf, personsOf, rsvpIdOf, type RsvpGuest, type SyncItem
} from './rules'

/**
 * Abgleich mit der Gästeliste in rsvp-app (docs/KONZEPT.md Abschnitt 9 B, dazu als Sicherheitsnetz
 * für verlorene Webhooks bei der Platzwahl über Zusagen). Seating fragt signiert an (guest-list-request),
 * rsvp-app antwortet signiert (guest-list) - nur, wenn die Verknüpfung dort eingetragen ist.
 *
 * Nichts passiert still: Die Vorschau listet neue, geänderte und weggefallene Zusagen, übernommen wird
 * nur, was die Veranstalter*in auswählt. Beim Übernehmen wird die Liste NEU geholt und neu verglichen -
 * die Auswahl aus dem Formular sind nur Schlüssel, nie Daten.
 */

type LinkedEvent = Pick<Event, 'id' | 'rsvpEventId' | 'mode'>

export type GuestListResult = { ok: true; guests: RsvpGuest[] } | { ok: false; error: string }

export async function fetchGuestList(event: LinkedEvent): Promise<GuestListResult> {
  const secret = rsvpSecret()
  const origin = rsvpAppOrigin()
  if (!secret || !origin) return { ok: false, error: 'Die Anbindung an rsvp-app ist nicht eingerichtet (RSVP_SEATING_SECRET, RSVP_APP_BASE_URL).' }
  if (!event.rsvpEventId) return { ok: false, error: 'Dieses Event ist mit keinem rsvp-app-Event verknüpft.' }
  const body = createMessage('guest-list-request', { aud: origin, seatingEventId: event.id, rsvpEventId: event.rsvpEventId }, secret)
  let response: Response
  try {
    response = await fetch(`${origin}/api/seating/guest-list`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: AbortSignal.timeout(10_000)
    })
  } catch {
    return { ok: false, error: 'rsvp-app ist gerade nicht erreichbar. Bitte versuch es später noch einmal.' }
  }
  if (response.status === 404 || response.status === 403) {
    return { ok: false, error: 'rsvp-app kennt diese Verknüpfung nicht. Ist dort beim Termin der Sitzplatz-Link dieses Events eingetragen?' }
  }
  if (!response.ok) return { ok: false, error: `rsvp-app hat die Anfrage abgelehnt (HTTP ${response.status}).` }
  const text = await response.text()
  const message = verifyMessage(text, 'guest-list', { secret, audience: seatingOrigin() })
  if (!message || message.seatingEventId !== event.id || message.rsvpEventId !== event.rsvpEventId) {
    return { ok: false, error: 'Die Antwort von rsvp-app ließ sich nicht prüfen (Signatur, Empfänger oder Verknüpfung passen nicht).' }
  }
  return { ok: true, guests: message.guests }
}

async function linkedBookings(event: LinkedEvent) {
  return prisma.booking.findMany({
    where: { eventId: event.id, status: 'CONFIRMED', externalRef: { startsWith: `rsvp:${event.rsvpEventId}:` } },
    include: { attendees: { orderBy: { position: 'asc' }, select: { id: true, externalKey: true, name: true } } }
  })
}

export type SyncPreview = { ok: true; items: SyncItem[]; unbooked: number | null; guests: number } | { ok: false; error: string }

/** Vorschau: was wäre zu tun? Sitzordnung: neue/geänderte/weggefallene Gruppen; Platzwahl: geänderte/weggefallene Buchungen. */
export async function syncPreview(event: LinkedEvent): Promise<SyncPreview> {
  const list = await fetchGuestList(event)
  if (!list.ok) return list
  const bookings = await linkedBookings(event)
  if (event.mode === 'ASSIGNED') {
    return { ok: true, items: diffParties(bookings.map(b => ({ ...b, persons: b.attendees })), list.guests, event.rsvpEventId!), unbooked: null, guests: list.guests.length }
  }
  const { items, unbooked } = diffBookings(bookings, list.guests, event.rsvpEventId!)
  return { ok: true, items, unbooked, guests: list.guests.length }
}

export type SyncResult = { ok: true; applied: number; skipped: number } | { ok: false; error: string }

/** Die ausgewählten Einträge übernehmen (keys: "<kind>:<rsvpId>" aus der Vorschau). */
export async function applySync(event: Event, keys: ReadonlySet<string>, actor: string, now = new Date()): Promise<SyncResult> {
  const list = await fetchGuestList(event)
  if (!list.ok) return list
  const rsvpEventId = event.rsvpEventId!
  const bookings = await linkedBookings(event)
  const guests = new Map(list.guests.map(g => [g.rsvpId, g]))
  const bookingOf = new Map(bookings.flatMap(b => {
    const rsvpId = rsvpIdOf(b.externalRef, rsvpEventId)
    return rsvpId ? [[rsvpId, b] as const] : []
  }))
  const items = event.mode === 'ASSIGNED'
    ? diffParties(bookings.map(b => ({ ...b, persons: b.attendees })), list.guests, rsvpEventId)
    : diffBookings(bookings, list.guests, rsvpEventId).items

  let applied = 0
  for (const item of items) {
    if (!keys.has(item.key)) continue
    const guest = guests.get(item.rsvpId)
    const booking = bookingOf.get(item.rsvpId)
    if (item.kind === 'removed' && booking) {
      if (await cancelRsvpBooking(event, booking, 'Keine Zusage mehr in rsvp-app (Abgleich)', now)) applied++
    } else if (item.kind === 'new' && guest && event.mode === 'ASSIGNED') {
      await createRsvpParty(event, guest, actor)
      applied++
    } else if (item.kind === 'changed' && guest && booking) {
      if (event.mode === 'ASSIGNED') await changeRsvpParty(event, { ...booking, persons: booking.attendees }, guest, actor)
      else await updateRsvpBooking(booking, guest, null, actor)
      applied++
    }
  }
  if (event.mode === 'ASSIGNED') await prisma.event.update({ where: { id: event.id }, data: { rsvpChangedAt: null } })
  await audit(prisma, { eventId: event.id, bookingId: null, actor, action: 'rsvp-synced', diff: { applied, guests: list.guests.length } })
  return { ok: true, applied, skipped: keys.size - applied }
}

/** Neue Gruppe aus einer Zusage (Sitzordnung): source RSVP, ohne Kontaktdaten, Personen mit externalKey. */
async function createRsvpParty(event: LinkedEvent, guest: RsvpGuest, actor: string) {
  const persons = personsOf(guest)
  await prisma.$transaction(async tx => {
    const booking = await tx.booking.create({
      data: {
        eventId: event.id, status: 'CONFIRMED', source: 'RSVP', name: guest.name, email: null, partySize: persons.length,
        externalRef: externalRefOf(event.rsvpEventId!, guest.rsvpId), rsvpPartySize: partySizeOf(guest),
        attendees: { create: persons.map((person, position) => ({ eventId: event.id, name: person.name, position, externalKey: person.key })) }
      }
    })
    await audit(tx, { eventId: event.id, bookingId: booking.id, actor, action: 'party-created', diff: { partySize: persons.length, fromRsvp: true } })
  })
}

/** Gruppe an die Zusage angleichen: Namen, Begleitungen dazu oder weg (ihr Platz wird frei). */
async function changeRsvpParty(event: LinkedEvent, party: Parameters<typeof partyChange>[0] & { id: string; partySize: number }, guest: RsvpGuest, actor: string) {
  const change = partyChange(party, guest)
  if (isEmptyChange(change)) return
  await prisma.$transaction(async tx => {
    for (const rename of change.rename) await tx.attendee.updateMany({ where: { id: rename.attendeeId, bookingId: party.id }, data: { name: rename.to } })
    if (change.remove.length > 0) await tx.attendee.deleteMany({ where: { id: { in: change.remove.map(r => r.attendeeId) }, bookingId: party.id } })
    if (change.add.length > 0) {
      const last = await tx.attendee.aggregate({ where: { bookingId: party.id }, _max: { position: true } })
      const next = (last._max.position ?? -1) + 1
      await tx.attendee.createMany({ data: change.add.map((p, i) => ({ eventId: event.id, bookingId: party.id, name: p.name, position: next + i, externalKey: p.key })) })
    }
    const count = await tx.attendee.count({ where: { bookingId: party.id } })
    await tx.booking.update({ where: { id: party.id }, data: { ...(change.name ? { name: change.name } : {}), partySize: count, rsvpPartySize: partySizeOf(guest) } })
    const diff: Prisma.InputJsonObject = {
      ...(change.name ? { name: { from: party.name, to: change.name } } : {}),
      ...(count !== party.partySize ? { partySize: { from: party.partySize, to: count } } : {}),
      ...(change.rename.length > 0 ? { renamed: change.rename.length } : {}),
      fromRsvp: true
    }
    await audit(tx, { eventId: event.id, bookingId: party.id, actor, action: 'party-changed', diff })
  })
}
