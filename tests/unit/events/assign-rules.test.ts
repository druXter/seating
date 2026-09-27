import { describe, expect, it } from 'vitest'
import type { Layout } from '../../../app/lib/floorplan/schema'
import { seatGroups } from '../../../app/lib/events/seat-rules'
import {
  MAX_PARTY, groupOfSeat, initials, parseGuestCsv, parsePartyEdit, parsePartyForm, partySeats, partySpread
} from '../../../app/lib/events/assign-rules'

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

// Block: 2 Reihen × 6 Plätze, Gang nach Platz 3; ein 4er-Tisch; ein Einzelstuhl.
const layout = {
  schemaVersion: 1, width: 2000, height: 1500, grid: 50, nextId: 4,
  elements: [
    {
      id: 'blk1', type: 'seatBlock', x: 800, y: 600, rotation: 0, rows: 2, seatsPerRow: 6, seatSpacing: 55, rowSpacing: 90,
      rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [3], omitted: [], curveRadius: 0, bookable: true
    },
    { id: 't2', type: 'table', shape: 'round', x: 300, y: 300, rotation: 0, width: 150, height: 150, seats: 4, sides: { top: true, right: true, bottom: true, left: true }, bookable: true },
    { id: 's3', type: 'seat', x: 100, y: 100, rotation: 0, label: '', bookable: true }
  ]
} as unknown as Layout

const groups = seatGroups(layout)
const all = groups.flatMap(g => g.segments.flat())
const key = (row: number, pos: number) => `blk1-r${row}-s${pos}`
const freeExcept = (...taken: string[]) => new Set(all.filter(k => !taken.includes(k)))

describe('parsePartyForm', () => {
  it('eine Person pro Zeile, Gruppenname optional (sonst die erste Person)', () => {
    expect(parsePartyForm(form({ persons: ' Erika  Muster \r\n\r\nMax Muster\n', name: '' }))).toEqual({
      ok: true, input: { name: 'Erika Muster', persons: ['Erika Muster', 'Max Muster'] }
    })
    expect(parsePartyForm(form({ persons: 'Erika', name: 'Familie Muster' }))).toMatchObject({ ok: true, input: { name: 'Familie Muster' } })
  })

  it('verlangt mindestens eine Person und begrenzt Länge und Anzahl', () => {
    expect(parsePartyForm(form({ persons: '\n \n' })).ok).toBe(false)
    expect(parsePartyForm(form({ persons: 'x'.repeat(101) })).ok).toBe(false)
    expect(parsePartyForm(form({ persons: Array.from({ length: MAX_PARTY + 1 }, (_, i) => `P${i}`).join('\n') })).ok).toBe(false)
  })

  it('entfernt Steuerzeichen', () => {
    expect(parsePartyForm(form({ persons: 'Erika\u0007 Muster' }))).toMatchObject({ ok: true, input: { persons: ['Erika Muster'] } })
  })
})

describe('parsePartyEdit', () => {
  const a = 'ckaaaaaaaaaaaaaaaaaaaaaa1'
  const b = 'ckaaaaaaaaaaaaaaaaaaaaaa2'

  it('liest umbenannte, entfernte und neue Personen', () => {
    const data = form({ name: 'Familie Muster', [`person:${a}`]: 'Erika M.', [`person:${b}`]: 'Max', [`remove:${b}`]: 'on', added: 'Oma Erna\n' })
    expect(parsePartyEdit(data)).toEqual({
      ok: true,
      input: { name: 'Familie Muster', persons: [{ id: a, name: 'Erika M.', remove: false }, { id: b, name: 'Max', remove: true }], added: ['Oma Erna'] }
    })
  })

  it('ignoriert Felder mit ungültiger id, verlangt Namen und mindestens eine Person', () => {
    expect(parsePartyEdit(form({ name: 'X', 'person:../x': 'Y', [`person:${a}`]: 'Erika' }))).toMatchObject({ ok: true, input: { persons: [{ id: a }] } })
    expect(parsePartyEdit(form({ name: 'X', [`person:${a}`]: '' })).ok).toBe(false)
    expect(parsePartyEdit(form({ name: 'X', [`person:${a}`]: 'Erika', [`remove:${a}`]: 'on' })).ok).toBe(false)
    expect(parsePartyEdit(form({ name: '', [`person:${a}`]: 'Erika' })).ok).toBe(false)
  })
})

describe('parseGuestCsv', () => {
  it('fasst Zeilen mit gleicher Gruppe zusammen (ohne Groß-/Kleinschreibung), ohne Gruppe ist jede Person eine eigene', () => {
    const result = parseGuestCsv('Name;Gruppe;Notiz\nErika Muster;Familie Muster;vegetarisch\nMax Muster;familie muster;\nOma Erna;;Rollstuhl\nMax Muster;Familie Muster;vegetarisch')
    expect(result).toEqual({
      ok: true, persons: 4,
      parties: [
        { name: 'Familie Muster', persons: ['Erika Muster', 'Max Muster', 'Max Muster'], note: 'vegetarisch' },
        { name: 'Oma Erna', persons: ['Oma Erna'], note: 'Rollstuhl' }
      ]
    })
  })

  it('findet die Spalten unabhängig von Reihenfolge und Schreibweise, Komma als Trenner', () => {
    expect(parseGuestCsv('Gruppe, NAME\nMuster,Erika')).toMatchObject({ ok: true, parties: [{ name: 'Muster', persons: ['Erika'] }] })
  })

  it('verlangt eine Kopfzeile mit Name und nennt fehlerhafte Zeilen - dann wird nichts übernommen', () => {
    expect(parseGuestCsv('Erika;Muster')).toMatchObject({ ok: false })
    expect(parseGuestCsv('')).toMatchObject({ ok: false })
    expect(parseGuestCsv('Name\n')).toMatchObject({ ok: false, errors: ['Die Datei enthält keine Gäste.'] })
    const result = parseGuestCsv(`Name;Gruppe\nErika;A\n;A\n${'x'.repeat(101)};B`)
    expect(result).toEqual({ ok: false, errors: ['Zeile 3: Name fehlt.', 'Zeile 4: Name ist länger als 100 Zeichen.'] })
  })

  it('begrenzt die Größe einer Gruppe', () => {
    const rows = Array.from({ length: MAX_PARTY + 1 }, (_, i) => `P${i};Groß`).join('\n')
    expect(parseGuestCsv(`Name;Gruppe\n${rows}`)).toMatchObject({ ok: false })
  })
})

describe('partySeats', () => {
  it('Reihe: ab dem Zielplatz nach rechts, sonst so weit nach links wie nötig - nie über den Gang', () => {
    expect(partySeats(groups, freeExcept(), key(1, 1), 3)).toEqual([key(1, 1), key(1, 2), key(1, 3)])
    expect(partySeats(groups, freeExcept(), key(1, 3), 2)).toEqual([key(1, 2), key(1, 3)])
    expect(partySeats(groups, freeExcept(key(1, 1)), key(1, 3), 3)).toBeNull()
    expect(partySeats(groups, freeExcept(), key(1, 3), 4)).toBeNull()
  })

  it('Tisch: Zielplatz und die folgenden freien Plätze reihum', () => {
    expect(partySeats(groups, freeExcept(), 't2-s3', 3)).toEqual(['t2-s3', 't2-s4', 't2-s1'])
    expect(partySeats(groups, freeExcept('t2-s4'), 't2-s3', 3)).toEqual(['t2-s3', 't2-s1', 't2-s2'])
    expect(partySeats(groups, freeExcept('t2-s1', 't2-s2'), 't2-s3', 3)).toBeNull()
  })

  it('Einzelplatz nur für eine Person; belegter Zielplatz oder unbekannter Platz: null', () => {
    expect(partySeats(groups, freeExcept(), 's3', 1)).toEqual(['s3'])
    expect(partySeats(groups, freeExcept(), 's3', 2)).toBeNull()
    expect(partySeats(groups, freeExcept('t2-s1'), 't2-s1', 1)).toBeNull()
    expect(partySeats(groups, freeExcept(), 'x9', 1)).toBeNull()
  })
})

describe('partySpread', () => {
  const groupOf = groupOfSeat(groups)

  it('zusammen: ein Tisch oder eine Reihe (auch über den Gang); getrennt: mehrere', () => {
    expect(partySpread(['t2-s1', 't2-s2'], groupOf)).toEqual(['Tisch 2'])
    expect(partySpread([key(1, 1), key(1, 6)], groupOf)).toEqual(['Reihe A'])
    expect(partySpread([key(1, 1), 't2-s1', key(1, 2)], groupOf)).toEqual(['Reihe A', 'Tisch 2'])
    expect(partySpread([], groupOf)).toEqual([])
  })
})

describe('initials', () => {
  it('erster und letzter Name, einzelnes Wort zwei Zeichen', () => {
    expect(initials('Erika Muster')).toBe('EM')
    expect(initials('erika von muster')).toBe('EM')
    expect(initials('Oma')).toBe('Om')
    expect(initials('Özlem Şahin')).toBe('ÖŞ')
    expect(initials('  ')).toBe('?')
    expect(initials('Max (Begleitung)')).toBe('MB')
  })
})
