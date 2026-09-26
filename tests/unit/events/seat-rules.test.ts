import { describe, expect, it } from 'vitest'
import type { Layout } from '../../../app/lib/floorplan/schema'
import {
  compactSeatLabels, largestTogether, seatGroups, seatsTogether, singleGapProblems, suggestSeats, validateSeatSelection
} from '../../../app/lib/events/seat-rules'

// Block: 2 Reihen × 6 Plätze, Gang nach Platz 3, Platz 5 in Reihe 2 ausgelassen; ein 4er-Tisch; ein Einzelstuhl.
const layout = {
  schemaVersion: 1, width: 2000, height: 1500, grid: 50, nextId: 4,
  elements: [
    {
      id: 'blk1', type: 'seatBlock', x: 800, y: 600, rotation: 0, rows: 2, seatsPerRow: 6, seatSpacing: 55, rowSpacing: 90,
      rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [3], omitted: ['2-5'], curveRadius: 0, bookable: true
    },
    { id: 't2', type: 'table', shape: 'round', x: 300, y: 300, rotation: 0, width: 150, height: 150, seats: 4, sides: { top: true, right: true, bottom: true, left: true }, bookable: true },
    { id: 's3', type: 'seat', x: 100, y: 100, rotation: 0, label: '', bookable: true }
  ]
} as unknown as Layout

const groups = seatGroups(layout)
const all = groups.flatMap(g => g.segments.flat())
const key = (row: number, pos: number) => `blk1-r${row}-s${pos}`

describe('seatGroups', () => {
  it('Reihen mit Abschnitten (Gang, ausgelassener Platz), Tische, Einzelplätze', () => {
    expect(groups.map(g => [g.kind, g.label])).toEqual([['row', 'Reihe A'], ['row', 'Reihe B'], ['table', 'Tisch 2'], ['single', 'Einzelplätze']])
    expect(groups[0].segments).toEqual([[key(1, 1), key(1, 2), key(1, 3)], [key(1, 4), key(1, 5), key(1, 6)]])
    expect(groups[1].segments).toEqual([[key(2, 1), key(2, 2), key(2, 3)], [key(2, 4)], [key(2, 6)]])
    expect(groups[2].segments).toEqual([['t2-s1', 't2-s2', 't2-s3', 't2-s4']])
  })
})

describe('suggestSeats', () => {
  it('erster Treffer nebeneinander, nie über einen Gang', () => {
    const free = new Set(all)
    expect(suggestSeats(groups, free, 3)).toEqual([key(1, 1), key(1, 2), key(1, 3)])
    free.delete(key(1, 2))
    expect(suggestSeats(groups, free, 3)).toEqual([key(1, 4), key(1, 5), key(1, 6)])
    expect(suggestSeats(groups, free, 4)).toEqual(['t2-s1', 't2-s2', 't2-s3', 't2-s4'])
    expect(suggestSeats(groups, free, 5)).toBeNull()
  })

  it('einzelne Plätze auch als Einzelstuhl', () => {
    expect(suggestSeats(groups, new Set(['s3']), 1)).toEqual(['s3'])
    expect(suggestSeats(groups, new Set(['s3']), 2)).toBeNull()
    expect(suggestSeats(groups, new Set(all), 0)).toBeNull()
  })

  it('größte mögliche Gruppe', () => {
    expect(largestTogether(groups, new Set(all))).toBe(4)
    expect(largestTogether(groups, new Set([key(1, 1), key(1, 2), key(1, 3)]))).toBe(3)
  })
})

describe('seatsTogether', () => {
  it('Reihe ohne Lücke, Tisch, nicht über Gang oder Lücke', () => {
    expect(seatsTogether(groups, [key(1, 2), key(1, 1)])).toBe(true)
    expect(seatsTogether(groups, [key(1, 1), key(1, 3)])).toBe(false)
    expect(seatsTogether(groups, [key(1, 3), key(1, 4)])).toBe(false)
    expect(seatsTogether(groups, ['t2-s1', 't2-s3'])).toBe(true)
    expect(seatsTogether(groups, ['t2-s1', key(1, 1)])).toBe(false)
    expect(seatsTogether(groups, [])).toBe(false)
  })
})

describe('Lückenregel (vorbereitet, noch nicht eingeschaltet)', () => {
  it('findet einen einzelnen freien Platz neben der Auswahl', () => {
    // Reihe A links: Platz 1 belegt, Auswahl Platz 3 -> Platz 2 bliebe einzeln frei.
    expect(singleGapProblems(groups, new Set([key(1, 1)]), new Set([key(1, 3)]))).toEqual([key(1, 2)])
    // Am Abschnittsende (Gang) zählt das Ende als Grenze: Auswahl 1+2 lässt 3 einzeln.
    expect(singleGapProblems(groups, new Set(), new Set([key(1, 1), key(1, 2)]))).toEqual([key(1, 3)])
    // Zwei freie Plätze sind keine Einzellücke.
    expect(singleGapProblems(groups, new Set(), new Set([key(1, 4)]))).toEqual([])
    // Tische sind ausgenommen.
    expect(singleGapProblems(groups, new Set(['t2-s1']), new Set(['t2-s3']))).toEqual([])
  })

  it('greift nur, wenn eingeschaltet', () => {
    const states = new Map(all.map(k => [k, k === key(1, 1) ? 'taken' as const : 'free' as const]))
    const labels = new Map<string, string>([[key(1, 2), 'Reihe A, Platz 2']])
    expect(validateSeatSelection([key(1, 3)], states, labels, groups, { maxSeats: 10, forbidSingleGaps: false })).toEqual([])
    expect(validateSeatSelection([key(1, 3)], states, labels, groups, { maxSeats: 10, forbidSingleGaps: true }))
      .toEqual(['Bitte lass keinen einzelnen Platz frei (Reihe A, Platz 2).'])
  })
})

describe('validateSeatSelection', () => {
  const states = new Map(all.map(k => [k, 'free' as const]))
  states.set(key(1, 1), 'taken' as never)
  states.set('s3', 'unavailable' as never)
  const labels = new Map([[key(1, 1), 'Reihe A, Platz 1'], ['s3', 'Platz 3']])
  const options = { maxSeats: 3, forbidSingleGaps: false }

  it('leer, doppelt, zu viele, unbekannt, belegt, nicht buchbar', () => {
    expect(validateSeatSelection([], states, labels, groups, options)).toEqual(['Bitte wähle mindestens einen Platz.'])
    expect(validateSeatSelection([key(1, 2), key(1, 2)], states, labels, groups, options)).toEqual(['Ein Platz ist doppelt gewählt.'])
    expect(validateSeatSelection([key(1, 2), key(1, 3), key(1, 4), key(1, 5)], states, labels, groups, options)).toEqual(['Pro Buchung sind höchstens 3 Plätze möglich.'])
    expect(validateSeatSelection(['x9'], states, labels, groups, options)).toEqual(['Diesen Platz gibt es nicht.'])
    expect(validateSeatSelection([key(1, 1)], states, labels, groups, options)).toEqual(['Reihe A, Platz 1 ist schon vergeben.'])
    expect(validateSeatSelection(['s3'], states, labels, groups, options)).toEqual(['Platz 3 ist nicht buchbar.'])
    expect(validateSeatSelection([key(1, 2), key(1, 3)], states, labels, groups, options)).toEqual([])
    expect(validateSeatSelection([key(1, 2), key(1, 3), key(1, 4), key(1, 5)], states, labels, groups, { ...options, maxSeats: null })).toEqual([])
  })
})

describe('compactSeatLabels', () => {
  it('fasst Reihen und Bereiche zusammen', () => {
    expect(compactSeatLabels(['Reihe A, Platz 5', 'Reihe A, Platz 3', 'Reihe A, Platz 4', 'Reihe A, Platz 7'])).toBe('Reihe A, Plätze 3–5, 7')
    expect(compactSeatLabels(['Reihe B, Platz 1', 'Reihe B, Platz 2'])).toBe('Reihe B, Plätze 1, 2')
    expect(compactSeatLabels(['Tisch 2, Platz 4', 'Parkett, Reihe A, Platz 1', 'Loge'])).toBe('Tisch 2, Platz 4; Parkett, Reihe A, Platz 1; Loge')
  })
})
