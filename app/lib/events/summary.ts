// app/lib/events/summary.ts
import type { EventMode } from '@prisma/client'
import { prisma } from '../prisma'
import { activeWhere } from './booking-tx'
import { countStates, type Counts } from './occupancy'
import { loadUnitStates } from './store'
import { seatingCounts } from './assign'

/**
 * Kennzahlen eines Events für die Übersicht „Events“ und die Übersicht eines Events (docs/KONZEPT-OBERFLAECHE.md).
 * Tisch- und Platzbuchung: Belegung der Tische bzw. Plätze, aktive Buchungen mit Personen, Warteliste.
 * Sitzordnung: Personen mit Platz, Gruppen, freie Plätze. Nur Zahlen - keine Namen.
 */
export type EventSummary =
  | { kind: 'booking'; unit: 'TABLE' | 'SEAT'; counts: Counts; bookable: number; bookings: number; guests: number; waitlist: number }
  | { kind: 'assigned'; counts: Counts; persons: number; seated: number; parties: number }

export async function eventSummary(event: { id: string; mode: EventMode }, now = new Date()): Promise<EventSummary> {
  const { units, states } = await loadUnitStates(event.id, now)
  if (event.mode === 'ASSIGNED') {
    const seating = await seatingCounts(event.id)
    return { kind: 'assigned', counts: countStates(units, states, 'SEAT'), ...seating }
  }
  const unit = event.mode === 'SEAT' ? 'SEAT' : 'TABLE'
  const counts = countStates(units, states, unit)
  const [active, waitlist] = await Promise.all([
    prisma.booking.findMany({ where: { eventId: event.id, ...activeWhere(now) }, select: { partySize: true } }),
    // Wie die Buchungsliste: nur bestätigte Einträge zählen (unbestätigte verfallen nach ihrer Frist).
    prisma.booking.count({ where: { eventId: event.id, status: 'WAITLISTED', waitlistedAt: { not: null } } })
  ])
  return {
    kind: 'booking', unit, counts,
    bookable: counts.free + counts.held + counts.confirmed,
    bookings: active.length,
    guests: active.reduce((sum, b) => sum + b.partySize, 0),
    waitlist
  }
}
