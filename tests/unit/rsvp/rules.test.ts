import { describe, expect, it } from 'vitest'
import {
  diffBookings, diffParties, externalRefOf, isEmptyChange, parseSyncKeys, partyChange, partySizeOf, personsOf, rsvpIdOf, type RsvpGuest
} from '../../../app/lib/rsvp/rules'

const ev = 'cmrsvpevent00000001'
const id = (n: number) => `cmrsvpanswer000000${n}`
const guest = (n: number, name: string, companions: (string | null)[] = [], email: string | null = null): RsvpGuest => ({ rsvpId: id(n), name, email, companions })

describe('Kennung und Personen', () => {
  it('externalRef hin und zurück, nur für dasselbe rsvp-Event', () => {
    const ref = externalRefOf(ev, id(1))
    expect(ref).toBe(`rsvp:${ev}:${id(1)}`)
    expect(rsvpIdOf(ref, ev)).toBe(id(1))
    expect(rsvpIdOf(ref, 'cmandereevent000001')).toBeNull()
    expect(rsvpIdOf(null, ev)).toBeNull()
  })

  it('Personenzahl und Namen: Begleitung ohne Namen heißt „Begleitung von …“', () => {
    expect(partySizeOf(guest(1, 'Erika'))).toBe(1)
    expect(personsOf(guest(1, 'Erika', ['Max', null]))).toEqual([
      { key: 'guest', name: 'Erika' }, { key: 'companion-1', name: 'Max' }, { key: 'companion-2', name: 'Begleitung von Erika' }
    ])
  })
})

describe('diffBookings (Platzwahl über Zusagen)', () => {
  const booking = (n: number, name: string, partySize: number, rsvpPartySize: number | null = partySize) =>
    ({ id: `b${n}`, externalRef: externalRefOf(ev, id(n)), name, partySize, rsvpPartySize })

  it('weggefallene Zusagen, geänderter Name bzw. Personenzahl, Zusagen ohne Buchung', () => {
    const result = diffBookings(
      [booking(1, 'Erika', 2), booking(2, 'Max', 1), booking(3, 'Pia', 2), { id: 'x', externalRef: null, name: 'Ohne', partySize: 1, rsvpPartySize: null }],
      [guest(1, 'Erika', ['Max']), guest(3, 'Pia Neu', []), guest(4, 'Neu')],
      ev
    )
    expect(result.unbooked).toBe(1)
    expect(result.items.map(i => [i.key, i.details])).toEqual([
      [`removed:${id(2)}`, ['Keine Zusage mehr in rsvp-app – die Buchung wird storniert.']],
      [`changed:${id(3)}`, ['Name: Pia → Pia Neu', 'Personen: 2 → 1']]
    ])
  })

  it('bereits übernommene Personenzahl (rsvpPartySize) ist kein neuer Eintrag', () => {
    expect(diffBookings([booking(1, 'Erika', 2, 3)], [guest(1, 'Erika', ['A', 'B'])], ev).items).toEqual([])
  })
})

describe('diffParties und partyChange (Sitzordnung)', () => {
  const party = (n: number, name: string, persons: [string | null, string][]) => ({
    id: `p${n}`, externalRef: externalRefOf(ev, id(n)), name,
    persons: persons.map(([key, personName], i) => ({ id: `a${n}${i}`, externalKey: key, name: personName }))
  })

  it('neu, geändert (Namen, Begleitung dazu/weg), weggefallen - von Hand ergänzte Personen bleiben', () => {
    const parties = [
      party(1, 'Erika', [['guest', 'Erika'], ['companion-1', 'Max'], [null, 'Kind (von Hand)']]),
      party(2, 'Paul', [['guest', 'Paul']]),
      party(3, 'Oma', [['guest', 'Oma']])
    ]
    const items = diffParties(parties, [guest(1, 'Erika M.', []), guest(2, 'Paul', ['Paula']), guest(4, 'Neu', [null])], ev)
    expect(items.map(i => [i.key, i.details])).toEqual([
      [`changed:${id(1)}`, ['Gruppe: Erika → Erika M.', 'Erika → Erika M.', 'entfällt: Max (Platz wird frei)']],
      [`changed:${id(2)}`, ['neu: Paula']],
      [`removed:${id(3)}`, ['Keine Zusage mehr in rsvp-app – die Gruppe wird abgesagt, ihre Plätze werden frei.']],
      [`new:${id(4)}`, ['2 Personen: Neu, Begleitung von Neu']]
    ])
  })

  it('unverändert: kein Eintrag', () => {
    const change = partyChange(party(1, 'Erika', [['guest', 'Erika'], ['companion-1', 'Max']]), guest(1, 'Erika', ['Max']))
    expect(isEmptyChange(change)).toBe(true)
  })
})

describe('parseSyncKeys', () => {
  it('nur bekannte Formen', () => {
    expect([...parseSyncKeys([`new:${id(1)}`, `changed:${id(2)}`, 'removed:../x', 'delete:all', 42, `removed:${id(3)}`])])
      .toEqual([`new:${id(1)}`, `changed:${id(2)}`, `removed:${id(3)}`])
  })
})
