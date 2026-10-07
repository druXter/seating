import { describe, expect, it } from 'vitest'
import { guestSeatingView } from '../../../app/lib/rsvp/guest-seating'

const board = {
  parties: [
    { id: 'p1', name: 'Familie Muster', adminNote: 'Oma braucht Rampe', spread: [], persons: [
      { id: 'a1', name: 'Erika Muster', seatKey: 's1' }, { id: 'a2', name: 'Max Muster', seatKey: 's2' }, { id: 'a3', name: 'Oma Erna', seatKey: null }
    ] },
    { id: 'p2', name: 'Kollegium', adminNote: null, spread: [], persons: [{ id: 'b1', name: 'Kim', seatKey: 's3' }] }
  ],
  seats: [
    { key: 's1', label: 'Tisch 1, Platz 1', group: 'Tisch 1', bookable: true, attendeeId: 'a1' },
    { key: 's2', label: 'Tisch 1, Platz 2', group: 'Tisch 1', bookable: true, attendeeId: 'a2' },
    { key: 's9', label: 'Tisch 1, Platz 3', group: 'Tisch 1', bookable: true, attendeeId: null },
    { key: 's3', label: 'Tisch 2, Platz 1', group: 'Tisch 2', bookable: true, attendeeId: 'b1' }
  ]
}

describe('guestSeatingView (Sitzordnung für Gäste mit Zusage)', () => {
  it('Namen je Tisch in Plan-Reihenfolge, eigene Plätze markiert', () => {
    const view = guestSeatingView(board, 'p1')
    expect(view.groups).toEqual([
      { label: 'Tisch 1', own: true, persons: [{ name: 'Erika Muster', seat: 'Tisch 1, Platz 1', own: true }, { name: 'Max Muster', seat: 'Tisch 1, Platz 2', own: true }] },
      { label: 'Tisch 2', own: false, persons: [{ name: 'Kim', seat: 'Tisch 2, Platz 1', own: false }] }
    ])
    expect(view.ownSeats).toEqual([
      { name: 'Erika Muster', seat: 'Tisch 1, Platz 1', group: 'Tisch 1' }, { name: 'Max Muster', seat: 'Tisch 1, Platz 2', group: 'Tisch 1' }
    ])
  })

  it('nur Namen und Plätze: keine Gruppennamen, Notizen oder Personen ohne Platz', () => {
    const text = JSON.stringify(guestSeatingView(board, 'p1'))
    for (const hidden of ['Familie Muster', 'Kollegium', 'Rampe', 'Oma Erna']) expect(text).not.toContain(hidden)
  })

  it('ohne eigene Gruppe (noch nicht abgeglichen): Sitzordnung ohne Markierung', () => {
    const view = guestSeatingView(board, null)
    expect(view.ownSeats).toEqual([])
    expect(view.groups.every(g => !g.own)).toBe(true)
  })
})
