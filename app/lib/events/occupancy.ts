// app/lib/events/occupancy.ts
import type { BookingStatus, UnitKind } from '@prisma/client'

/**
 * Belegung eines Events aus Units + Allocations (docs/KONZEPT.md Abschnitt 5). Reine Funktionen -
 * die Abfrage steht in store.ts, damit die Regeln ohne Datenbank testbar sind.
 *
 * Eine Einheit ist belegt, wenn eine Allocation zu einer Buchung gehört, die CONFIRMED ist oder
 * PENDING/OFFERED mit expiresAt in der Zukunft. Abgelaufenes wird also schon beim LESEN ignoriert;
 * der Cron und das Speichern räumen nur auf.
 */

export type UnitState = 'free' | 'confirmed' | 'held' | 'unavailable'

/** Was die öffentliche Ansicht zeigt: bestätigt und reserviert sehen gleich aus ("belegt"). */
export type PublicUnitState = 'free' | 'occupied' | 'unavailable'

export type StateUnit = { key: string; kind: UnitKind; tableKey: string | null; bookable: boolean }
export type StateAllocation = { unitKey: string; status: BookingStatus; expiresAt: Date | null }

/** Buchungsstatus, die eine Einheit nur bis expiresAt halten. */
export const HOLDING_STATUSES: readonly BookingStatus[] = ['PENDING', 'OFFERED']

/** Hält diese Buchung ihre Einheiten (noch)? */
export function holdsUnits(booking: { status: BookingStatus; expiresAt: Date | null }, now: Date): boolean {
  if (booking.status === 'CONFIRMED') return true
  return HOLDING_STATUSES.includes(booking.status) && booking.expiresAt !== null && booking.expiresAt > now
}

const RANK: Record<UnitState, number> = { free: 0, unavailable: 1, held: 2, confirmed: 3 }

function stronger(a: UnitState, b: UnitState): UnitState {
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * Zustand jeder Einheit. Gemischte Belegung (Konzept Abschnitt 3): Ist ein Tisch als Ganzes
 * belegt, gelten seine Plätze als belegt - und ist einer seiner Plätze belegt, der Tisch.
 * Nicht buchbare Einheiten sind "unavailable", außer sie sind trotzdem belegt (z.B. vom Admin
 * vergeben) - dann zählt die Belegung.
 */
export function unitStates(units: readonly StateUnit[], allocations: readonly StateAllocation[], now: Date): Map<string, UnitState> {
  const direct = new Map<string, UnitState>()
  for (const allocation of allocations) {
    if (!holdsUnits(allocation, now)) continue
    const state: UnitState = allocation.status === 'CONFIRMED' ? 'confirmed' : 'held'
    direct.set(allocation.unitKey, stronger(direct.get(allocation.unitKey) ?? 'free', state))
  }

  // Belegung über die Tisch-Zugehörigkeit weitergeben (in beide Richtungen).
  const byTable = new Map<string, UnitState>()
  for (const unit of units) {
    const state = direct.get(unit.key)
    if (!state) continue
    const table = unit.kind === 'TABLE' ? unit.key : unit.tableKey
    if (table) byTable.set(table, stronger(byTable.get(table) ?? 'free', state))
  }

  const result = new Map<string, UnitState>()
  for (const unit of units) {
    const table = unit.kind === 'TABLE' ? unit.key : unit.tableKey
    let state = direct.get(unit.key) ?? 'free'
    if (table) state = stronger(state, byTable.get(table) ?? 'free')
    if (state === 'free' && !unit.bookable) state = 'unavailable'
    result.set(unit.key, state)
  }
  return result
}

export function publicState(state: UnitState): PublicUnitState {
  return state === 'confirmed' || state === 'held' ? 'occupied' : state
}

/**
 * Passt eine Gruppe an einen Tisch? partySize ≤ capacity und - falls eine Mindestbelegung gesetzt
 * ist - partySize ≥ ceil(capacity × minFillRatio) (Konzept Abschnitt 4, Schritt 2).
 */
export function tableFits(capacity: number, partySize: number, minFillRatio: number | null): boolean {
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > capacity) return false
  if (minFillRatio === null) return true
  return partySize >= Math.ceil(capacity * minFillRatio - 1e-9)
}

export type Counts = { free: number; held: number; confirmed: number; unavailable: number }

/** Zähler für den Admin-Bereich, nur über Einheiten einer Art (im Modus TABLE: Tische). */
export function countStates(units: readonly StateUnit[], states: ReadonlyMap<string, UnitState>, kind: UnitKind): Counts {
  const counts: Counts = { free: 0, held: 0, confirmed: 0, unavailable: 0 }
  for (const unit of units) if (unit.kind === kind) counts[states.get(unit.key) ?? 'free']++
  return counts
}
