// app/lib/floorplan/units.ts
import { blockSeatPositions, letters, tableSeatPositions, toWorld, type Point } from './geometry'
import type { Layout, LayoutElement, SeatBlockElement, TableElement } from './schema'

/**
 * Buchbare Einheiten eines Plans - EINE Ableitung für Editor, Kundenansicht und die Übernahme in
 * ein Event (Phase 2: Tabelle Unit). Schlüssel sind stabil und hängen nur an ids und Positionen,
 * nie an Beschriftungen, Lage oder Drehung:
 *
 *   Tisch               t12            Platz am Tisch    t12-s3   (Platz 3 im Uhrzeigersinn)
 *   Einzelner Stuhl     s5
 *   Platz im Block      blk1-r2-s12    (Reihe 2 von vorne, Position 12 von links - nicht Beschriftung
 *                                       "Reihe B, Platz 12", die sich über rowStart/numbering ändern darf)
 */
export type Unit = {
  key: string
  kind: 'TABLE' | 'SEAT'
  label: string
  /** Bei Plätzen an einem Tisch: dessen Schlüssel (gemischte Belegung verhindern, siehe Konzept Abschnitt 3). */
  tableKey: string | null
  capacity: number
  bookable: boolean
  /** Mittelpunkt im Raum (cm). */
  position: Point
  /** Element, aus dem die Einheit stammt. */
  elementId: string
}

function numberOf(id: string): string {
  return id.replace(/^[a-z]+/, '')
}

export function tableLabel(table: Pick<TableElement, 'id' | 'label'>): string {
  return table.label || `Tisch ${numberOf(table.id)}`
}

export function rowLabel(block: Pick<SeatBlockElement, 'rowLabels' | 'rowStart'>, row: number): string {
  const n = block.rowStart + row - 1
  return block.rowLabels === 'letters' ? letters(n) : String(n)
}

export function seatNumber(block: Pick<SeatBlockElement, 'numbering' | 'seatStart' | 'seatsPerRow'>, position: number): number {
  const index = block.numbering === 'ltr' ? position : block.seatsPerRow - position + 1
  return block.seatStart + index - 1
}

export function elementUnits(element: LayoutElement): Unit[] {
  const origin = { x: element.x, y: element.y }
  switch (element.type) {
    case 'table': {
      const label = tableLabel(element)
      const units: Unit[] = [{
        key: element.id, kind: 'TABLE', label, tableKey: null, capacity: element.seats,
        bookable: element.bookable, position: origin, elementId: element.id
      }]
      tableSeatPositions(element).forEach((local, index) => {
        units.push({
          key: `${element.id}-s${index + 1}`, kind: 'SEAT', label: `${label}, Platz ${index + 1}`, tableKey: element.id,
          capacity: 1, bookable: element.bookable, position: toWorld(local, origin, element.rotation), elementId: element.id
        })
      })
      return units
    }
    case 'seat':
      return [{
        key: element.id, kind: 'SEAT', label: element.label || `Platz ${numberOf(element.id)}`, tableKey: null,
        capacity: 1, bookable: element.bookable, position: origin, elementId: element.id
      }]
    case 'seatBlock':
      return blockSeatPositions(element).map(seat => {
        const name = `Reihe ${rowLabel(element, seat.row)}, Platz ${seatNumber(element, seat.position)}`
        return {
          key: `${element.id}-r${seat.row}-s${seat.position}`, kind: 'SEAT' as const,
          label: element.label ? `${element.label}, ${name}` : name, tableKey: null, capacity: 1,
          bookable: element.bookable, position: toWorld(seat.local, origin, element.rotation), elementId: element.id
        }
      })
    case 'static':
      return []
  }
}

export function deriveUnits(layout: Layout): Unit[] {
  return layout.elements.flatMap(elementUnits)
}

/** Kurzüberblick für Listen: Anzahl Tische, Plätze insgesamt, davon buchbar. */
export function summarize(layout: Layout): { tables: number; seats: number } {
  const units = deriveUnits(layout)
  return {
    tables: units.filter(u => u.kind === 'TABLE').length,
    seats: units.filter(u => u.kind === 'SEAT').length
  }
}
