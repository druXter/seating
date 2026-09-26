import { describe, expect, it } from 'vitest'
import { auditDiff, calendarRelevant, changeLabels, changeRows, diffBooking } from '../../../app/lib/events/booking-changes'

const before = { name: 'Max', phone: null, note: 'vegetarisch', partySize: 4, tableKey: 't1' }

describe('diffBooking', () => {
  it('ohne Änderung leer', () => {
    expect(diffBooking(before, { ...before })).toEqual([])
    expect(calendarRelevant([])).toBe(false)
  })

  it('erkennt jedes Feld in fester Reihenfolge', () => {
    const changes = diffBooking(before, { name: 'Moritz', phone: '0171', note: null, partySize: 6, tableKey: 't3' })
    expect(changes.map(c => c.field)).toEqual(['name', 'phone', 'note', 'partySize', 'table'])
    expect(changeLabels(changes)).toEqual(['Name', 'Telefon', 'Anmerkung', 'Personenzahl', 'Tisch'])
    expect(auditDiff(changes)).toEqual({
      name: { from: 'Max', to: 'Moritz' }, phone: { from: null, to: '0171' }, note: { from: 'vegetarisch', to: null },
      partySize: { from: 4, to: 6 }, table: { from: 't1', to: 't3' }
    })
  })

  it('nur Personenzahl und Tisch ändern den Kalendereintrag', () => {
    expect(calendarRelevant(diffBooking(before, { ...before, name: 'Moritz', note: null }))).toBe(false)
    expect(calendarRelevant(diffBooking(before, { ...before, partySize: 5 }))).toBe(true)
    expect(calendarRelevant(diffBooking(before, { ...before, tableKey: 't2' }))).toBe(true)
  })
})

describe('changeRows', () => {
  it('stellt alt und neu gegenüber, Tische mit Beschriftung, leere Werte als –', () => {
    const changes = diffBooking(before, { ...before, phone: '0171', note: null, tableKey: 't3' })
    const labels: Record<string, string> = { t1: 'Tisch 1', t3: 'Fenstertisch' }
    expect(changeRows(changes, key => labels[key])).toEqual([
      ['Telefon', '– → 0171'], ['Anmerkung', 'vegetarisch → –'], ['Tisch', 'Tisch 1 → Fenstertisch']
    ])
  })
})
