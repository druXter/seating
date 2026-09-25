import { describe, expect, it } from 'vitest'
import { deriveUnits, summarize } from '../../../app/lib/floorplan/units'
import { cloneElement, createElement, withElement } from '../../../app/lib/floorplan/factory'
import { emptyLayout, parseLayout } from '../../../app/lib/floorplan/schema'
import { sampleLayout } from './fixtures'

describe('deriveUnits', () => {
  it('leitet Tische, Tischplätze, Stühle und Blockplätze mit stabilen Schlüsseln ab', () => {
    const units = deriveUnits(sampleLayout())
    const keys = units.map(u => u.key)
    expect(keys).toContain('t1')
    expect(keys).toContain('t1-s8')
    expect(keys).toContain('t2-s6')
    expect(keys).toContain('s3')
    expect(keys).toContain('blk4-r1-s2')
    expect(keys).not.toContain('blk4-r1-s1') // weggelassen
    expect(new Set(keys).size).toBe(keys.length)
    expect(summarize(sampleLayout())).toEqual({ tables: 2, seats: 8 + 6 + 1 + 11 })
  })

  it('Tisch: Kapazität = Plätze, Plätze verweisen auf den Tisch', () => {
    const units = deriveUnits(sampleLayout())
    expect(units.find(u => u.key === 't1')).toMatchObject({ kind: 'TABLE', capacity: 8, label: 'Tisch 1', tableKey: null })
    expect(units.find(u => u.key === 't2-s1')).toMatchObject({ kind: 'SEAT', tableKey: 't2', label: 'Ehrentisch, Platz 1' })
  })

  it('Blockplätze: Beschriftung aus Reihen-/Platzzählung, Schlüssel aus der Position', () => {
    const layout = sampleLayout()
    const block = layout.elements[3]
    if (block.type !== 'seatBlock') throw new Error()
    const before = deriveUnits(layout).filter(u => u.elementId === 'blk4')
    expect(before.find(u => u.key === 'blk4-r2-s1')?.label).toBe('Reihe B, Platz 1')

    // Beschriftung umstellen: Zählung ab Reihe C, von rechts, ab 101 - Schlüssel bleiben gleich.
    Object.assign(block, { rowStart: 3, numbering: 'rtl', seatStart: 101, label: 'Parkett' })
    const after = deriveUnits(layout).filter(u => u.elementId === 'blk4')
    expect(after.map(u => u.key)).toEqual(before.map(u => u.key))
    expect(after.find(u => u.key === 'blk4-r2-s1')?.label).toBe('Parkett, Reihe D, Platz 104')
  })

  it('Verschieben, Drehen und Umbenennen ändern keine Schlüssel', () => {
    const layout = sampleLayout()
    const before = deriveUnits(layout).map(u => u.key)
    for (const element of layout.elements) {
      element.x += 123
      element.rotation = 45
      element.label = 'Neu'
    }
    expect(deriveUnits(layout).map(u => u.key)).toEqual(before)
  })

  it('Positionen folgen Lage und Drehung', () => {
    const layout = sampleLayout()
    const seat = () => deriveUnits(layout).find(u => u.key === 't1-s1')!.position
    expect(seat()).toEqual({ x: 300, y: 300 - 75 - 35 })
    layout.elements[0].rotation = 90
    expect(seat()).toEqual({ x: 300 + 75 + 35, y: 300 })
  })
})

describe('factory', () => {
  it('vergibt fortlaufende ids und erzeugt gültige Elemente', () => {
    let layout = emptyLayout(2000, 2000)
    const kinds = [
      { type: 'table', shape: 'round' }, { type: 'table', shape: 'rect' }, { type: 'table', shape: 'oval' },
      { type: 'seat' }, { type: 'seatBlock' }, { type: 'static', kind: 'stage' }, { type: 'static', kind: 'text' }
    ] as const
    for (const kind of kinds) layout = withElement(layout, kind, { x: 500, y: 500 }).layout
    expect(layout.elements.map(e => e.id)).toEqual(['t1', 't2', 't3', 's4', 'blk5', 'o6', 'o7'])
    expect(layout.nextId).toBe(8)
    expect(parseLayout(layout).ok).toBe(true)
  })

  it('neue Tische teilen sich kein Seiten-Objekt', () => {
    const a = createElement({ type: 'table', shape: 'rect' }, { x: 0, y: 0 }, 1).element
    const b = createElement({ type: 'table', shape: 'rect' }, { x: 0, y: 0 }, 2).element
    if (a.type !== 'table' || b.type !== 'table') throw new Error()
    a.sides.top = false
    expect(b.sides.top).toBe(true)
  })

  it('Duplizieren: neue id, tiefe Kopie, versetzt', () => {
    const original = sampleLayout().elements[3]
    const { element, nextId } = cloneElement(original, { x: 50, y: 50 }, 9)
    expect(element.id).toBe('blk9')
    expect(nextId).toBe(10)
    expect(element.x).toBe(original.x + 50)
    if (element.type !== 'seatBlock' || original.type !== 'seatBlock') throw new Error()
    element.omitted.push('2-2')
    expect(original.omitted).toEqual(['1-1'])
  })
})
