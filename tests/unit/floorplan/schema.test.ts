/* eslint-disable @typescript-eslint/no-explicit-any -- die Tests bauen absichtlich ungültige Pläne */
import { describe, expect, it } from 'vitest'
import { LIMITS, emptyLayout, parseExport, parseLayout, EXPORT_FORMAT } from '../../../app/lib/floorplan/schema'
import { sampleLayout } from './fixtures'

describe('parseLayout', () => {
  it('akzeptiert einen gültigen Plan mit allen Elementarten', () => {
    const result = parseLayout(sampleLayout())
    expect(result.ok).toBe(true)
  })

  it('akzeptiert einen leeren Plan', () => {
    expect(parseLayout(emptyLayout(1000, 800)).ok).toBe(true)
  })

  it('bereinigt Beschriftungen (Steuerzeichen, Leerraum)', () => {
    const layout = sampleLayout()
    layout.elements[0].label = '  Tisch\u0000 A\n  '
    const result = parseLayout(layout)
    expect(result.ok && result.layout.elements[0].label).toBe('Tisch A')
  })

  it.each([
    ['falsche Version', (l: any) => { l.schemaVersion = 2 }],
    ['unbekanntes Feld', (l: any) => { l.extra = true }],
    ['unbekanntes Feld im Element', (l: any) => { l.elements[0].onclick = 'alert(1)' }],
    ['__proto__ als Schlüssel', (l: any) => JSON.parse(JSON.stringify(l).replace('"schemaVersion"', '"__proto__":{"x":1},"schemaVersion"'))],
    ['unbekannter Elementtyp', (l: any) => { l.elements[0].type = 'sofa' }],
    ['id passt nicht zum Typ', (l: any) => { l.elements[0].id = 's1' }],
    ['id mit HTML', (l: any) => { l.elements[0].id = 't1"><script>' }],
    ['doppelte id', (l: any) => { l.elements[1].id = 't1' }],
    ['nextId zu klein', (l: any) => { l.nextId = 5 }],
    ['Raum zu groß', (l: any) => { l.width = LIMITS.maxRoomSize + 1 }],
    ['Koordinate außerhalb', (l: any) => { l.elements[0].x = 1e9 }],
    ['keine Zahl', (l: any) => { l.elements[0].x = 'abc' }],
    ['NaN über JSON', (l: any) => { l.elements[0].x = null }],
    ['Drehung 360', (l: any) => { l.elements[0].rotation = 360 }],
    ['zu viele Plätze am Tisch', (l: any) => { l.elements[0].seats = LIMITS.maxSeatsPerTable + 1 }],
    ['Kommazahl bei Plätzen', (l: any) => { l.elements[0].seats = 2.5 }],
    ['rechteckiger Tisch ohne Seite', (l: any) => { l.elements[1].sides = { top: false, right: false, bottom: false, left: false } }],
    ['Gang am Rand', (l: any) => { l.elements[3].aisles = [4] }],
    ['doppelter Gang', (l: any) => { l.elements[3].aisles = [2, 2] }],
    ['weggelassener Platz außerhalb', (l: any) => { l.elements[3].omitted = ['9-1'] }],
    ['zu lange Beschriftung', (l: any) => { l.elements[0].label = 'x'.repeat(LIMITS.maxLabelLength + 1) }],
    ['unbekannte Objektart', (l: any) => { l.elements[4].kind = 'iframe' }]
  ])('lehnt ab: %s', (_name, mutate) => {
    const layout: any = sampleLayout()
    const mutated = mutate(layout) ?? layout
    const result = parseLayout(mutated)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })

  it('begrenzt die Gesamtzahl der Plätze', () => {
    const layout = sampleLayout()
    layout.elements = Array.from({ length: 2 }, (_, i) => ({
      id: `blk${i + 1}`, type: 'seatBlock' as const, x: 500, y: 500, rotation: 0, rows: 50, seatsPerRow: 31, seatSpacing: 55,
      rowSpacing: 90, rowLabels: 'letters' as const, rowStart: 1, numbering: 'ltr' as const, seatStart: 1, aisles: [], omitted: [],
      curveRadius: 0, bookable: true
    }))
    const result = parseLayout(layout)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toMatch(/Zu viele Plätze/)
  })

  it('begrenzt die Zahl der Elemente', () => {
    const layout = emptyLayout(10000, 10000)
    layout.nextId = LIMITS.maxElements + 2
    layout.elements = Array.from({ length: LIMITS.maxElements + 1 }, (_, i) => ({ id: `s${i + 1}`, type: 'seat' as const, x: 1, y: 1, rotation: 0, bookable: true }))
    expect(parseLayout(layout).ok).toBe(false)
  })
})

describe('parseExport', () => {
  it('liest eine Export-Datei und verwirft die Lage des Hintergrundbilds', () => {
    const layout = { ...sampleLayout(), background: { x: 0, y: 0, width: 2000, opacity: 0.5 } }
    const result = parseExport({ format: EXPORT_FORMAT, name: ' Festsaal ', layout })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('Festsaal')
      expect(result.layout.background).toBeUndefined()
    }
  })

  it('lehnt beliebiges JSON ab', () => {
    expect(parseExport({ layout: sampleLayout() }).ok).toBe(false)
    expect(parseExport([1, 2, 3]).ok).toBe(false)
    expect(parseExport(null).ok).toBe(false)
  })

  it('meldet Fehler im enthaltenen Plan', () => {
    const layout: any = sampleLayout()
    layout.elements[0].seats = -1
    const result = parseExport({ format: EXPORT_FORMAT, layout })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/^elements\.0\.seats/)
  })
})
