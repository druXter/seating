// app/lib/floorplan/factory.ts
import type { Layout, LayoutElement, StaticKind } from './schema'

/** Was sich über die Werkzeugleiste hinzufügen lässt. */
export type NewElementKind =
  | { type: 'table'; shape: 'round' | 'rect' | 'oval' }
  | { type: 'seat' }
  | { type: 'seatBlock' }
  | { type: 'static'; kind: StaticKind }

const PREFIX: Record<LayoutElement['type'], string> = { table: 't', seat: 's', seatBlock: 'blk', static: 'o' }

export const STATIC_LABELS: Record<StaticKind, string> = {
  stage: 'Bühne',
  danceFloor: 'Tanzfläche',
  bar: 'Bar',
  buffet: 'Buffet',
  door: 'Tür',
  pillar: 'Säule',
  wall: 'Wand',
  text: 'Text'
}

/**
 * Legt ein neues Element mit sinnvollen Standardwerten an und vergibt die nächste id. Gibt das
 * Element und den neuen Zähler zurück - der Zähler läuft nur vorwärts (siehe schema.ts nextId).
 */
export function createElement(kind: NewElementKind, at: { x: number; y: number }, nextId: number): { element: LayoutElement; nextId: number } {
  const id = `${PREFIX[kind.type]}${nextId}`
  const base = { x: at.x, y: at.y, rotation: 0 }
  let element: LayoutElement
  switch (kind.type) {
    case 'table':
      element = kind.shape === 'round'
        ? { ...base, id, type: 'table', shape: 'round', width: 150, height: 150, seats: 8, sides: { ...allSides }, bookable: true }
        : kind.shape === 'oval'
          ? { ...base, id, type: 'table', shape: 'oval', width: 220, height: 120, seats: 10, sides: { ...allSides }, bookable: true }
          : { ...base, id, type: 'table', shape: 'rect', width: 200, height: 80, seats: 6, sides: { ...allSides }, bookable: true }
      break
    case 'seat':
      element = { ...base, id, type: 'seat', bookable: true }
      break
    case 'seatBlock':
      element = {
        ...base, id, type: 'seatBlock', rows: 5, seatsPerRow: 10, seatSpacing: 55, rowSpacing: 90,
        rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [], omitted: [], curveRadius: 0, bookable: true
      }
      break
    case 'static': {
      const [width, height, shape] = STATIC_SIZES[kind.kind]
      element = { ...base, id, type: 'static', kind: kind.kind, shape, width, height, label: STATIC_LABELS[kind.kind] }
      break
    }
  }
  return { element, nextId: nextId + 1 }
}

const allSides = { top: true, right: true, bottom: true, left: true }

const STATIC_SIZES: Record<StaticKind, [number, number, 'rect' | 'round']> = {
  stage: [600, 300, 'rect'],
  danceFloor: [500, 500, 'rect'],
  bar: [400, 80, 'rect'],
  buffet: [400, 100, 'rect'],
  door: [100, 20, 'rect'],
  pillar: [50, 50, 'round'],
  wall: [500, 20, 'rect'],
  text: [300, 60, 'rect']
}

/** Kopie eines Elements mit neuer id (Duplizieren). */
export function cloneElement(element: LayoutElement, offset: { x: number; y: number }, nextId: number): { element: LayoutElement; nextId: number } {
  const id = `${PREFIX[element.type]}${nextId}`
  const copy = structuredClone(element)
  return { element: { ...copy, id, x: element.x + offset.x, y: element.y + offset.y } as LayoutElement, nextId: nextId + 1 }
}

/** Fügt ein Element in den Plan ein (unveränderlich - der Editor braucht alte Stände für Rückgängig). */
export function withElement(layout: Layout, kind: NewElementKind, at: { x: number; y: number }): { layout: Layout; id: string } {
  const { element, nextId } = createElement(kind, at, layout.nextId)
  return { layout: { ...layout, nextId, elements: [...layout.elements, element] }, id: element.id }
}
