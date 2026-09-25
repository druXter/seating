import { describe, expect, it } from 'vitest'
import { SEAT_OFFSET, blockSeatPositions, distribute, letters, tableSeatPositions, toWorld } from '../../../app/lib/floorplan/geometry'

const allSides = { top: true, right: true, bottom: true, left: true }

describe('distribute', () => {
  it('verteilt proportional und vollständig', () => {
    expect(distribute(6, [200, 80, 200, 80])).toEqual([2, 1, 2, 1])
    expect(distribute(6, [200, 0, 200, 0])).toEqual([3, 0, 3, 0])
    expect(distribute(0, [1, 1])).toEqual([0, 0])
    for (let n = 0; n <= 40; n++) expect(distribute(n, [200, 80, 200, 80]).reduce((a, b) => a + b, 0)).toBe(n)
  })
})

describe('tableSeatPositions', () => {
  it('runder Tisch: alle Plätze im gleichen Abstand, Platz 1 oben', () => {
    const seats = tableSeatPositions({ shape: 'round', width: 150, height: 999, seats: 8, sides: allSides })
    expect(seats).toHaveLength(8)
    for (const s of seats) expect(Math.hypot(s.x, s.y)).toBeCloseTo(75 + SEAT_OFFSET, 0)
    expect(seats[0]).toEqual({ x: 0, y: -(75 + SEAT_OFFSET) })
    expect(seats[2].x).toBeGreaterThan(0) // im Uhrzeigersinn: Platz 3 rechts
  })

  it('rechteckiger Tisch: nur an aktiven Seiten, außerhalb der Tischfläche', () => {
    const seats = tableSeatPositions({ shape: 'rect', width: 200, height: 80, seats: 6, sides: { top: true, right: false, bottom: true, left: false } })
    expect(seats).toHaveLength(6)
    expect(seats.filter(s => s.y < 0)).toHaveLength(3)
    expect(seats.filter(s => s.y > 0)).toHaveLength(3)
    for (const s of seats) expect(Math.abs(s.y)).toBe(40 + SEAT_OFFSET)
  })

  it('ovaler Tisch und Tisch ohne Plätze', () => {
    expect(tableSeatPositions({ shape: 'oval', width: 220, height: 120, seats: 10, sides: allSides })).toHaveLength(10)
    expect(tableSeatPositions({ shape: 'round', width: 150, height: 150, seats: 0, sides: allSides })).toEqual([])
  })
})

describe('blockSeatPositions', () => {
  const block = { rows: 3, seatsPerRow: 4, seatSpacing: 50, rowSpacing: 100, aisles: [] as number[], omitted: [] as string[], curveRadius: 0 }

  it('gerader Block: zentriert, Reihe 1 vorne (oben)', () => {
    const seats = blockSeatPositions(block)
    expect(seats).toHaveLength(12)
    expect(seats[0]).toEqual({ row: 1, position: 1, local: { x: -75, y: -100 } })
    expect(seats[11]).toEqual({ row: 3, position: 4, local: { x: 75, y: 100 } })
  })

  it('Gang schiebt die Plätze rechts davon um eine Platzbreite', () => {
    const seats = blockSeatPositions({ ...block, aisles: [2] })
    const row1 = seats.filter(s => s.row === 1).map(s => s.local.x)
    expect(row1).toEqual([-100, -50, 50, 100])
  })

  it('weggelassene Plätze fehlen, die übrigen behalten ihre Position', () => {
    const seats = blockSeatPositions({ ...block, omitted: ['1-1', '3-4'] })
    expect(seats).toHaveLength(10)
    expect(seats[0]).toMatchObject({ row: 1, position: 2, local: { x: -25, y: -100 } })
  })

  it('gekrümmter Block: Mitte wie gerade, Ränder rücken nach vorne', () => {
    const seats = blockSeatPositions({ ...block, seatsPerRow: 5, curveRadius: 500 })
    const row1 = seats.filter(s => s.row === 1)
    expect(row1[2].local).toEqual({ x: 0, y: -100 })
    expect(row1[0].local.y).toBeLessThan(-100)
    expect(row1[0].local.x).toBeCloseTo(-row1[4].local.x, 5)
  })
})

describe('toWorld und letters', () => {
  it('dreht im Uhrzeigersinn und verschiebt', () => {
    expect(toWorld({ x: 10, y: 0 }, { x: 100, y: 100 }, 90)).toEqual({ x: 100, y: 110 })
    expect(toWorld({ x: 10, y: 0 }, { x: 0, y: 0 }, 0)).toEqual({ x: 10, y: 0 })
  })

  it('Reihenbuchstaben wie in Tabellenkalkulationen', () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(letters)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA'])
  })
})
