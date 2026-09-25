// app/lib/floorplan/geometry.ts
import type { LayoutElement, SeatBlockElement, TableElement } from './schema'

/**
 * Reine Geometrie-Funktionen (keine Abhängigkeit von React oder dem Browser), damit Editor,
 * Kundenansicht und Server dieselben Positionen berechnen und sie per Unit-Test prüfbar sind.
 */

export type Point = { x: number; y: number }

/** Durchmesser eines Stuhls in der Darstellung (cm). */
export const SEAT_SIZE = 45
/** Abstand Tischkante -> Stuhlmitte (cm). */
export const SEAT_OFFSET = 35

const round1 = (value: number) => Math.round(value * 10) / 10

/** Dreht einen Punkt um den Ursprung (Grad, im Uhrzeigersinn wie SVG) und verschiebt ihn. */
export function toWorld(local: Point, origin: Point, rotationDeg: number): Point {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: round1(origin.x + local.x * cos - local.y * sin),
    y: round1(origin.y + local.x * sin + local.y * cos)
  }
}

/** Verteilt n Plätze auf Abschnitte proportional zu deren Länge (Verfahren des größten Rests). */
export function distribute(n: number, lengths: number[]): number[] {
  const total = lengths.reduce((s, l) => s + l, 0)
  if (n === 0 || total === 0) return lengths.map(() => 0)
  const exact = lengths.map(l => (n * l) / total)
  const counts = exact.map(Math.floor)
  let rest = n - counts.reduce((s, c) => s + c, 0)
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (rest === 0) break
    counts[i]++
    rest--
  }
  return counts
}

/**
 * Stuhlpositionen um einen Tisch, relativ zu dessen Mittelpunkt (vor Drehung). Reihenfolge =
 * Platznummer 1..n: rund/oval ab "oben" im Uhrzeigersinn; rechteckig oben (links->rechts),
 * rechts (oben->unten), unten (rechts->links), links (unten->oben) - nur an aktiven Seiten.
 */
export function tableSeatPositions(table: Pick<TableElement, 'shape' | 'width' | 'height' | 'seats' | 'sides'>): Point[] {
  const n = table.seats
  if (n === 0) return []

  if (table.shape === 'round' || table.shape === 'oval') {
    const a = (table.width / 2) + SEAT_OFFSET
    const b = (table.shape === 'round' ? table.width / 2 : table.height / 2) + SEAT_OFFSET
    return Array.from({ length: n }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
      return { x: round1(a * Math.cos(angle)), y: round1(b * Math.sin(angle)) }
    })
  }

  const w = table.width / 2
  const h = table.height / 2
  const o = SEAT_OFFSET
  // Seiten im Uhrzeigersinn, jeweils mit Start- und Endpunkt der Stuhlreihe.
  const sides = [
    { on: table.sides.top, from: { x: -w, y: -h - o }, to: { x: w, y: -h - o }, length: table.width },
    { on: table.sides.right, from: { x: w + o, y: -h }, to: { x: w + o, y: h }, length: table.height },
    { on: table.sides.bottom, from: { x: w, y: h + o }, to: { x: -w, y: h + o }, length: table.width },
    { on: table.sides.left, from: { x: -w - o, y: h }, to: { x: -w - o, y: -h }, length: table.height }
  ]
  const counts = distribute(n, sides.map(s => (s.on ? s.length : 0)))
  const points: Point[] = []
  sides.forEach((side, index) => {
    const count = counts[index]
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      points.push({ x: round1(side.from.x + (side.to.x - side.from.x) * t), y: round1(side.from.y + (side.to.y - side.from.y) * t) })
    }
  })
  return points
}

export type BlockSeat = {
  /** Positionen 1-basiert: Reihe von vorne (oben), Platz von links - Grundlage des stabilen Schlüssels. */
  row: number
  position: number
  local: Point
}

/** Horizontale Lage (in Platzbreiten) eines Platzes inkl. der Gänge links davon. */
function slotOf(position: number, aisles: number[]): number {
  return position - 1 + aisles.filter(a => a < position).length
}

/**
 * Plätze eines Reihenblocks relativ zu dessen Mittelpunkt (vor Drehung). Reihe 1 ist vorne
 * (oben, kleinstes y). Bei curveRadius > 0 liegen die Reihen auf Bögen um einen Punkt vor dem
 * Block, die Platzabstände bleiben entlang des Bogens gleich.
 */
export function blockSeatPositions(block: Pick<SeatBlockElement, 'rows' | 'seatsPerRow' | 'seatSpacing' | 'rowSpacing' | 'aisles' | 'omitted' | 'curveRadius'>): BlockSeat[] {
  const omitted = new Set(block.omitted)
  const slots = block.seatsPerRow + block.aisles.length
  const middleSlot = (slots - 1) / 2
  const middleRow = (block.rows - 1) / 2
  const seats: BlockSeat[] = []

  for (let row = 1; row <= block.rows; row++) {
    for (let position = 1; position <= block.seatsPerRow; position++) {
      if (omitted.has(`${row}-${position}`)) continue
      const along = (slotOf(position, block.aisles) - middleSlot) * block.seatSpacing
      let local: Point
      if (block.curveRadius > 0) {
        const radius = block.curveRadius + (row - 1) * block.rowSpacing
        const angle = along / radius
        const centerY = -middleRow * block.rowSpacing - block.curveRadius
        local = { x: round1(radius * Math.sin(angle)), y: round1(centerY + radius * Math.cos(angle)) }
      } else {
        local = { x: round1(along), y: round1((row - 1 - middleRow) * block.rowSpacing) }
      }
      seats.push({ row, position, local })
    }
  }
  return seats
}

/** Achsenparalleler Umriss eines Elements VOR der Drehung (Breite, Höhe), für Auswahlrahmen und Treffer. */
export function localSize(element: LayoutElement): { width: number; height: number } {
  switch (element.type) {
    case 'table': {
      const w = element.width
      const h = element.shape === 'round' ? element.width : element.height
      const extra = element.seats > 0 ? 2 * (SEAT_OFFSET + SEAT_SIZE / 2) : 0
      return { width: w + extra, height: h + extra }
    }
    case 'seat':
      return { width: SEAT_SIZE, height: SEAT_SIZE }
    case 'seatBlock': {
      const seats = blockSeatPositions(element)
      if (seats.length === 0) return { width: SEAT_SIZE, height: SEAT_SIZE }
      const xs = seats.map(s => Math.abs(s.local.x))
      const ys = seats.map(s => Math.abs(s.local.y))
      return { width: 2 * Math.max(...xs) + SEAT_SIZE, height: 2 * Math.max(...ys) + SEAT_SIZE }
    }
    case 'static':
      return { width: element.width, height: element.shape === 'round' ? element.width : element.height }
  }
}

/** Buchstaben-Beschriftung für Reihen: 1 -> A, 26 -> Z, 27 -> AA. */
export function letters(n: number): string {
  let result = ''
  let value = n
  while (value > 0) {
    const rest = (value - 1) % 26
    result = String.fromCharCode(65 + rest) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

/** Rastet einen Wert auf das Raster ein. */
export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid
}
