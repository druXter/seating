import { describe, expect, it } from 'vitest'
import { checkLayoutChange, diffUnits, type StoredUnit } from '../../../app/lib/events/layout-change'
import type { Unit } from '../../../app/lib/floorplan/units'

function unit(key: string, patch: Partial<Unit> = {}): Unit {
  return {
    key, kind: key.includes('-s') || key.startsWith('s') ? 'SEAT' : 'TABLE', label: `Einheit ${key}`, tableKey: null,
    capacity: 8, bookable: true, position: { x: 0, y: 0 }, elementId: key.split('-')[0], ...patch
  }
}

describe('checkLayoutChange', () => {
  const occupied = [{ key: 't1', label: 'Tisch 1', partySize: 6 }]

  it('erlaubt Umbenennen, Verschieben und Vergrößern', () => {
    expect(checkLayoutChange([unit('t1', { label: 'VIP', position: { x: 50, y: 70 }, capacity: 10 })], occupied)).toEqual([])
  })

  it('erlaubt Verkleinern bis zur belegten Personenzahl', () => {
    expect(checkLayoutChange([unit('t1', { capacity: 6 })], occupied)).toEqual([])
  })

  it('lehnt Löschen, Verkleinern darunter und Sperren ab', () => {
    expect(checkLayoutChange([], occupied)).toEqual(['Tisch 1 ist belegt und kann nicht entfernt werden.'])
    expect(checkLayoutChange([unit('t1', { capacity: 5 })], occupied)[0]).toContain('mit 6 Personen belegt')
    expect(checkLayoutChange([unit('t1', { bookable: false })], occupied)[0]).toContain('nicht buchbar')
  })

  it('freie Einheiten dürfen sich beliebig ändern', () => {
    expect(checkLayoutChange([unit('t1')], [])).toEqual([])
  })

  it('meldet jede betroffene Einheit', () => {
    const errors = checkLayoutChange([], [...occupied, { key: 's2', label: 'Platz 2', partySize: 1 }])
    expect(errors).toHaveLength(2)
  })
})

describe('diffUnits', () => {
  const stored = (key: string, patch: Partial<StoredUnit> = {}): StoredUnit => {
    const { key: k, kind, label, tableKey, capacity, bookable } = unit(key)
    return { id: `id-${key}`, key: k, kind, label, tableKey, capacity, bookable, ...patch }
  }

  it('schreibt nur Änderungen', () => {
    const diff = diffUnits(
      [stored('t1'), stored('t2'), stored('t3')],
      [unit('t1'), unit('t2', { label: 'Neu' }), unit('t4')]
    )
    expect(diff.create.map(u => u.key)).toEqual(['t4'])
    expect(diff.update).toEqual([{ id: 'id-t2', data: expect.objectContaining({ key: 't2', label: 'Neu' }) }])
    expect(diff.remove).toEqual(['id-t3'])
  })

  it('erkennt geänderte Kapazität, Buchbarkeit und Tisch-Zugehörigkeit', () => {
    for (const patch of [{ capacity: 4 }, { bookable: false }, { tableKey: 't9' }]) {
      expect(diffUnits([stored('t1')], [unit('t1', patch)]).update).toHaveLength(1)
    }
  })
})
