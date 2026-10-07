// app/lib/rsvp/guest-seating.ts
import type { Event } from '@prisma/client'
import { prisma } from '../prisma'
import { loadSeatingBoard, type BoardParty, type BoardSeat } from '../events/assign'
import { isPubliclyVisible } from '../events/store'
import { externalRefOf } from './rules'
import type { SeatLink } from './booking'

/**
 * Sitzordnung mit Namen für Gäste (Idee L10 der Suite, Event.guestSeatingVisible): nur im Modus ASSIGNED
 * und nur auf der Einstiegsseite aus rsvp-app (/rsvp/<eventId>, signierter Link einer Zusage). Gezeigt
 * werden ausschließlich Namen und Plätze der platzierten Personen - keine Gruppen, keine internen Notizen,
 * keine Personen ohne Platz.
 */
export type GuestSeatingGroup = { label: string; own: boolean; persons: { name: string; seat: string; own: boolean }[] }
export type GuestSeatingView = { groups: GuestSeatingGroup[]; ownSeats: { name: string; seat: string; group: string }[] }

/** Reine Aufbereitung (Reihenfolge wie im Plan): ownPartyId ist die Gruppe der Zusage, null = keine. */
export function guestSeatingView(board: { parties: BoardParty[]; seats: BoardSeat[] }, ownPartyId: string | null): GuestSeatingView {
  const persons = new Map(board.parties.flatMap(party => party.persons.map(person => [person.id, { name: person.name, own: party.id === ownPartyId }] as const)))
  const groups = new Map<string, GuestSeatingGroup>()
  const ownSeats: GuestSeatingView['ownSeats'] = []
  for (const seat of board.seats) {
    const person = seat.attendeeId ? persons.get(seat.attendeeId) : undefined
    if (!person) continue
    const group = groups.get(seat.group) ?? { label: seat.group, own: false, persons: [] }
    group.persons.push({ name: person.name, seat: seat.label, own: person.own })
    if (person.own) {
      group.own = true
      ownSeats.push({ name: person.name, seat: seat.label, group: seat.group })
    }
    groups.set(seat.group, group)
  }
  return { groups: [...groups.values()], ownSeats }
}

/**
 * Lädt die Ansicht für einen geprüften Link - null, wenn das Event sie nicht zeigt. Entwürfe und
 * archivierte Events nie: Eine halbfertige Sitzordnung soll nicht vorzeitig bei den Gästen landen.
 */
export async function loadGuestSeating(event: Event, link: SeatLink): Promise<GuestSeatingView | null> {
  if (event.mode !== 'ASSIGNED' || !event.guestSeatingVisible || !isPubliclyVisible(event.status)) return null
  const [board, own] = await Promise.all([
    loadSeatingBoard(event),
    prisma.booking.findFirst({ where: { eventId: event.id, status: 'CONFIRMED', externalRef: externalRefOf(link.rsvpEventId, link.rsvpId) }, select: { id: true } })
  ])
  return guestSeatingView(board, own?.id ?? null)
}
