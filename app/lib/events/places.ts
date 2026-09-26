// app/lib/events/places.ts
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { parseLayout } from '../floorplan/schema'
import { loadUnitStates } from './store'
import { activeWhere, releaseStaleHolds, type Tx } from './booking-tx'
import { compactSeatLabels, gapRuleFor, seatGroups, validateSeatSelection, type SeatGroup, type SeatState } from './seat-rules'

/**
 * Plätze bzw. Tische einer Buchung - was gebucht ist (Beschriftung für Mails, Kalender, Listen) und die
 * Prüfung einer Platzauswahl im Modus SEAT gegen die aktuelle Belegung (Regeln: seat-rules.ts).
 */

export type Place = { id: string; key: string; label: string; kind: 'TABLE' | 'SEAT'; capacity: number; tableKey: string | null }

/** Kurzbeschreibung: ein Tisch mit seinem Namen, Plätze zusammengefasst ("Reihe A, Plätze 3–5"). */
export function describePlaces(places: readonly Pick<Place, 'label' | 'kind'>[]): string {
  if (places.length === 0) return '–'
  if (places.length === 1 && places[0].kind === 'TABLE') return places[0].label
  return compactSeatLabels(places.map(p => p.label))
}

export async function placesOf(bookingId: string): Promise<Place[]> {
  const allocations = await prisma.allocation.findMany({
    where: { bookingId },
    select: { unit: { select: { id: true, key: true, label: true, kind: true, capacity: true, tableKey: true } } },
    orderBy: { unit: { key: 'asc' } }
  })
  return allocations.map(a => a.unit)
}

export async function placeLabelOf(bookingId: string): Promise<string> {
  return describePlaces(await placesOf(bookingId))
}

export type SeatContext = {
  groups: SeatGroup[]
  states: Map<string, SeatState>
  labels: Map<string, string>
  units: Map<string, Place & { bookable: boolean }>
}

/**
 * Zustand aller Plätze eines Events. ownBookingId: deren Plätze gelten als frei (Ändern). admin:
 * nicht buchbare, aber freie Plätze sind wählbar (Veranstalter*innen dürfen sie vergeben).
 */
export async function seatContext(event: { id: string; layout: unknown }, now: Date, options: { ownBookingId?: string; admin?: boolean } = {}): Promise<SeatContext> {
  const parsed = parseLayout(event.layout)
  const [{ states: unitStates }, units, own] = await Promise.all([
    loadUnitStates(event.id, now),
    prisma.unit.findMany({ where: { eventId: event.id, kind: 'SEAT' }, select: { id: true, key: true, label: true, kind: true, capacity: true, tableKey: true, bookable: true } }),
    options.ownBookingId ? prisma.allocation.findMany({ where: { bookingId: options.ownBookingId }, select: { unit: { select: { key: true } } } }) : Promise.resolve([])
  ])
  const ownKeys = new Set(own.map(a => a.unit.key))
  const states = new Map<string, SeatState>()
  for (const unit of units) {
    const state = unitStates.get(unit.key) ?? 'free'
    if (ownKeys.has(unit.key) || state === 'free') states.set(unit.key, 'free')
    else if (state === 'unavailable') states.set(unit.key, options.admin ? 'free' : 'unavailable')
    else states.set(unit.key, 'taken')
  }
  return {
    groups: parsed.ok ? seatGroups(parsed.layout) : [],
    states,
    labels: new Map(units.map(u => [u.key, u.label])),
    units: new Map(units.map(u => [u.key, u]))
  }
}

export type SeatCheck = { ok: true; places: Place[]; label: string } | { ok: false; errors: string[] }

/** Prüft eine Platzauswahl (Modus SEAT). maxSeats null: keine Obergrenze (Veranstalter*innen). */
export async function checkSeats(
  event: { id: string; layout: unknown }, keys: readonly string[], options: { ownBookingId?: string; admin?: boolean; maxSeats: number | null }, now: Date
): Promise<SeatCheck> {
  const context = await seatContext(event, now, options)
  const errors = validateSeatSelection(keys, context.states, context.labels, context.groups, { maxSeats: options.maxSeats, forbidSingleGaps: gapRuleFor(event) })
  if (errors.length > 0) return { ok: false, errors }
  const places = keys.map(key => context.units.get(key)!)
  return { ok: true, places, label: describePlaces(places) }
}

/**
 * Belegung einer Buchung auf die Zieleinheiten setzen (innerhalb einer Transaktion): abgelaufene Holds
 * auf den Zielen freigeben, gemischte Belegung prüfen (ein Ziel-Platz, dessen Tisch als Ganzes belegt
 * ist, oder ein Ziel-Tisch mit belegten Plätzen), alte Allocations weg, neue rein. Doppelbuchung
 * verhindert der Unique-Index - die aufrufende Funktion fängt P2002 ab. Gibt false zurück, wenn die
 * gemischte Belegung ein Ziel sperrt.
 */
export async function setAllocations(tx: Tx, eventId: string, bookingId: string, targets: readonly Pick<Place, 'id' | 'key' | 'kind' | 'tableKey'>[], now: Date): Promise<boolean> {
  await releaseStaleHolds(tx, eventId, targets.map(t => t.id), now)
  // Gemischte Belegung: Ein Ziel-Tisch ist gesperrt, wenn einer seiner Plätze belegt ist; ein Ziel-Platz,
  // wenn sein Tisch als Ganzes belegt ist - andere Plätze am selben Tisch sperren ihn nicht.
  const tables = targets.filter(t => t.kind === 'TABLE').map(t => t.key)
  const tablesOfSeats = targets.flatMap(t => (t.kind === 'SEAT' && t.tableKey ? [t.tableKey] : []))
  const conflicts: Prisma.AllocationWhereInput[] = [
    ...(tables.length > 0 ? [{ unit: { tableKey: { in: tables } } }] : []),
    ...(tablesOfSeats.length > 0 ? [{ unit: { key: { in: tablesOfSeats }, kind: 'TABLE' as const } }] : [])
  ]
  if (conflicts.length > 0) {
    const blocking = await tx.allocation.count({ where: { eventId, bookingId: { not: bookingId }, booking: activeWhere(now), OR: conflicts } })
    if (blocking > 0) return false
  }
  const current = await tx.allocation.findMany({ where: { bookingId }, select: { id: true, unitId: true } })
  const wanted = new Set(targets.map(t => t.id))
  await tx.allocation.deleteMany({ where: { bookingId, unitId: { notIn: [...wanted] } } })
  const existing = new Set(current.map(a => a.unitId))
  const missing = targets.filter(t => !existing.has(t.id))
  if (missing.length > 0) await tx.allocation.createMany({ data: missing.map(t => ({ eventId, unitId: t.id, bookingId })) })
  return true
}

/** Daten für die Platzwahl (app/ui/plan/seat-picker.tsx): nur Schlüssel, Beschriftung, Zustand. */
export async function seatPickerData(event: { id: string; layout: unknown }, now: Date, options: { ownBookingId?: string; admin?: boolean } = {}) {
  const context = await seatContext(event, now, options)
  const order = new Map(context.groups.flatMap(g => g.segments.flat()).map((key, index) => [key, index]))
  const seats = [...context.units.values()]
    .sort((a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9))
    .map(unit => ({ key: unit.key, label: unit.label, state: context.states.get(unit.key) ?? 'unavailable' }))
  return { seats, groups: context.groups }
}
