// app/lib/events/layout-change.ts
import type { UnitKind } from '@prisma/client'
import type { Unit as DerivedUnit } from '../floorplan/units'

/**
 * Regeln für Änderungen am Plan eines Events (docs/KONZEPT.md Abschnitt 2), als reine Funktionen.
 * Angewendet in layout.ts innerhalb der Speicher-Transaktion.
 */

/** Eine aktuell belegte Einheit (nur Buchungen, die ihre Einheiten noch halten). */
export type OccupiedUnit = { key: string; label: string; partySize: number }

/**
 * Belegte Einheiten dürfen nicht wegfallen, nicht als "nicht buchbar" markiert und (Tische) nicht
 * unter die belegte Personenzahl verkleinert werden. Umbenennen und Verschieben geht immer.
 * Gibt die Fehlermeldungen zurück (leer = erlaubt).
 */
export function checkLayoutChange(next: readonly DerivedUnit[], occupied: readonly OccupiedUnit[]): string[] {
  const byKey = new Map(next.map(unit => [unit.key, unit]))
  const errors: string[] = []
  for (const unit of occupied) {
    const updated = byKey.get(unit.key)
    if (!updated) {
      errors.push(`${unit.label} ist belegt und kann nicht entfernt werden.`)
    } else if (!updated.bookable) {
      errors.push(`${unit.label} ist belegt und kann nicht auf „nicht buchbar“ gesetzt werden.`)
    } else if (updated.kind === 'TABLE' && updated.capacity < unit.partySize) {
      errors.push(`${unit.label} ist mit ${unit.partySize} Personen belegt, hätte aber nur noch ${updated.capacity} Plätze.`)
    }
  }
  return errors
}

export type StoredUnit = { id: string; key: string; kind: UnitKind; label: string; tableKey: string | null; capacity: number; bookable: boolean }
export type UnitFields = Omit<StoredUnit, 'id'>

export type UnitDiff = { create: UnitFields[]; update: { id: string; data: UnitFields }[]; remove: string[] }

function fieldsOf(unit: DerivedUnit): UnitFields {
  return { key: unit.key, kind: unit.kind, label: unit.label, tableKey: unit.tableKey, capacity: unit.capacity, bookable: unit.bookable }
}

/**
 * Abgleich der Tabelle Unit mit dem neuen Plan: nur geänderte Zeilen schreiben (ein Plan kann
 * einige tausend Plätze haben). remove enthält ids.
 */
export function diffUnits(existing: readonly StoredUnit[], next: readonly DerivedUnit[]): UnitDiff {
  const current = new Map(existing.map(unit => [unit.key, unit]))
  const diff: UnitDiff = { create: [], update: [], remove: [] }
  const keep = new Set<string>()
  for (const unit of next) {
    const data = fieldsOf(unit)
    const stored = current.get(unit.key)
    keep.add(unit.key)
    if (!stored) {
      diff.create.push(data)
    } else if (
      stored.kind !== data.kind || stored.label !== data.label || stored.tableKey !== data.tableKey ||
      stored.capacity !== data.capacity || stored.bookable !== data.bookable
    ) {
      diff.update.push({ id: stored.id, data })
    }
  }
  for (const unit of existing) if (!keep.has(unit.key)) diff.remove.push(unit.id)
  return diff
}
