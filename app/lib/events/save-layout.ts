// app/lib/events/save-layout.ts
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { deriveUnits } from '../floorplan/units'
import type { Layout } from '../floorplan/schema'
import { HOLDING_STATUSES } from './occupancy'
import { checkLayoutChange, diffUnits } from './layout-change'

export type EventLayoutResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict' }
  | { ok: false; reason: 'occupied'; errors: string[] }

class Rejected extends Error {
  constructor(readonly errors: string[]) {
    super('rejected')
  }
}

/**
 * Ersetzt den Plan eines Events (Editor oder "aus Vorlage neu übernehmen") und gleicht die Tabelle
 * Unit ab - alles in EINER Transaktion:
 *
 *   1. bedingtes Hochzählen der Version (id UND baseVersion): Hat inzwischen jemand anderes
 *      gespeichert, Abbruch als Konflikt. Als erste Anweisung schreibt sie zugleich - SQLite
 *      vergibt die Schreibsperre damit sofort, die folgenden Prüfungen sehen einen festen Stand.
 *   2. abgelaufene Holds (PENDING/OFFERED nach expiresAt) auf EXPIRED setzen und ihre Allocations
 *      löschen - sie sollen das Ändern des Plans nicht blockieren,
 *   3. belegte Einheiten prüfen (checkLayoutChange),
 *   4. Plan schreiben, Units anlegen/ändern/löschen.
 *
 * Das Löschen einer belegten Einheit verhindert zusätzlich die Datenbank (Allocation.unit ist
 * NoAction) - käme trotz allem eine Belegung dazwischen, scheitert die Transaktion als Ganzes.
 */
export async function replaceEventLayout(eventId: string, baseVersion: number, layout: Layout, now = new Date()): Promise<EventLayoutResult> {
  const units = deriveUnits(layout)
  try {
    await prisma.$transaction(async tx => {
      const bumped = await tx.event.updateMany({
        where: { id: eventId, layoutVersion: baseVersion },
        data: { layoutVersion: { increment: 1 } }
      })
      if (bumped.count === 0) throw new Rejected([])

      const stale = await tx.booking.findMany({
        where: { eventId, status: { in: [...HOLDING_STATUSES] }, expiresAt: { lte: now } },
        select: { id: true }
      })
      if (stale.length > 0) {
        const ids = stale.map(b => b.id)
        await tx.allocation.deleteMany({ where: { bookingId: { in: ids } } })
        await tx.booking.updateMany({ where: { id: { in: ids } }, data: { status: 'EXPIRED' } })
      }

      // Nach Schritt 2 hält jede verbliebene Allocation ihre Einheit (CONFIRMED oder noch gültig).
      const allocations = await tx.allocation.findMany({
        where: { eventId, booking: { status: { in: ['CONFIRMED', ...HOLDING_STATUSES] } } },
        select: { unit: { select: { key: true, label: true } }, booking: { select: { partySize: true } } }
      })
      const errors = checkLayoutChange(units, allocations.map(a => ({ key: a.unit.key, label: a.unit.label, partySize: a.booking.partySize })))
      if (errors.length > 0) throw new Rejected(errors)

      await tx.event.update({ where: { id: eventId }, data: { layout } })
      const existing = await tx.unit.findMany({ where: { eventId } })
      const diff = diffUnits(existing, units)
      if (diff.remove.length > 0) await tx.unit.deleteMany({ where: { id: { in: diff.remove } } })
      for (const { id, data } of diff.update) await tx.unit.update({ where: { id }, data })
      if (diff.create.length > 0) await tx.unit.createMany({ data: diff.create.map(unit => ({ ...unit, eventId })) })
    })
  } catch (error) {
    if (error instanceof Rejected) {
      return error.errors.length > 0 ? { ok: false, reason: 'occupied', errors: error.errors } : { ok: false, reason: 'conflict' }
    }
    // Fremdschlüssel: Zwischen Prüfung und Löschen wurde doch eine Einheit belegt.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return { ok: false, reason: 'occupied', errors: ['Eine der entfernten Einheiten wurde gerade belegt. Bitte lade den Plan neu.'] }
    }
    throw error
  }
  return { ok: true, version: baseVersion + 1 }
}

/** Units für ein neu angelegtes Event (noch ohne Belegung). */
export function initialUnits(layout: Layout) {
  return deriveUnits(layout).map(unit => ({
    key: unit.key, kind: unit.kind, label: unit.label, tableKey: unit.tableKey, capacity: unit.capacity, bookable: unit.bookable
  }))
}
