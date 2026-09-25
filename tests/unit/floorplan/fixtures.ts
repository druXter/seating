import type { Layout } from '../../../app/lib/floorplan/schema'

/** Kleiner, gültiger Plan mit jeder Elementart. */
export function sampleLayout(): Layout {
  return {
    schemaVersion: 1,
    width: 2000,
    height: 1500,
    grid: 50,
    nextId: 6,
    elements: [
      { id: 't1', type: 'table', shape: 'round', x: 300, y: 300, rotation: 0, width: 150, height: 150, seats: 8, sides: { top: true, right: true, bottom: true, left: true }, bookable: true },
      { id: 't2', type: 'table', shape: 'rect', x: 800, y: 300, rotation: 90, width: 200, height: 80, seats: 6, sides: { top: true, right: false, bottom: true, left: false }, bookable: true, label: 'Ehrentisch' },
      { id: 's3', type: 'seat', x: 1200, y: 300, rotation: 0, bookable: true },
      {
        id: 'blk4', type: 'seatBlock', x: 1000, y: 1000, rotation: 0, rows: 3, seatsPerRow: 4, seatSpacing: 55, rowSpacing: 90,
        rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [2], omitted: ['1-1'], curveRadius: 0, bookable: true
      },
      { id: 'o5', type: 'static', kind: 'stage', shape: 'rect', x: 1000, y: 100, rotation: 0, width: 600, height: 150, label: 'Bühne' }
    ]
  }
}
