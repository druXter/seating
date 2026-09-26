import { describe, expect, it } from 'vitest'
import { offerDeadline, planOffers, waitlistChoice } from '../../../app/lib/events/waitlist-rules'

const t = (key: string, capacity: number) => ({ key, label: `Tisch ${key.slice(1)}`, capacity })
const e = (id: string, partySize: number, minute: number) => ({ id, partySize, waitlistedAt: new Date(Date.UTC(2026, 9, 1, 12, minute)) })

describe('planOffers', () => {
  it('ältester passender Eintrag zuerst, große Gruppen werden übersprungen, wenn der Tisch nicht passt', () => {
    const offers = planOffers([t('t1', 4)], [e('gross', 8, 0), e('klein', 3, 5), e('spaeter', 2, 9)], null)
    expect(offers.map(o => [o.bookingId, o.table.key])).toEqual([['klein', 't1']])
  })

  it('kleinste Tische zuerst - der große bleibt für die große Gruppe', () => {
    const offers = planOffers([t('t8', 8), t('t4', 4)], [e('vier', 4, 0), e('acht', 8, 1)], null)
    expect(offers.map(o => [o.bookingId, o.table.key])).toEqual([['vier', 't4'], ['acht', 't8']])
  })

  it('jeder Eintrag höchstens ein Angebot, jeder Tisch höchstens eines', () => {
    const offers = planOffers([t('t1', 6), t('t2', 6), t('t3', 6)], [e('a', 2, 0), e('b', 2, 1)], null)
    expect(offers.map(o => o.bookingId)).toEqual(['a', 'b'])
    expect(new Set(offers.map(o => o.table.key)).size).toBe(2)
  })

  it('Mindestbelegung gilt auch für Angebote', () => {
    expect(planOffers([t('t1', 8)], [e('zwei', 2, 0)], 0.5)).toEqual([])
    expect(planOffers([t('t1', 8)], [e('zwei', 2, 0), e('vier', 4, 1)], 0.5).map(o => o.bookingId)).toEqual(['vier'])
  })

  it('ohne freie Tische oder Einträge nichts', () => {
    expect(planOffers([], [e('a', 2, 0)], null)).toEqual([])
    expect(planOffers([t('t1', 4)], [], null)).toEqual([])
  })
})

describe('offerDeadline', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  const startsAt = new Date('2026-10-10T18:00:00Z')

  it('offerTtlHours ab jetzt', () => {
    expect(offerDeadline(now, { offerTtlHours: 24, startsAt, bookingClosesAt: null }).toISOString()).toBe('2026-10-02T12:00:00.000Z')
  })

  it('nie über Buchungsschluss bzw. Beginn hinaus', () => {
    const closes = new Date('2026-10-01T20:00:00Z')
    expect(offerDeadline(now, { offerTtlHours: 24, startsAt, bookingClosesAt: closes })).toEqual(closes)
    expect(offerDeadline(now, { offerTtlHours: 24, startsAt: new Date('2026-10-01T15:00:00Z'), bookingClosesAt: null }).toISOString()).toBe('2026-10-01T15:00:00.000Z')
  })
})

describe('waitlistChoice', () => {
  const tables = [
    { capacity: 4, bookable: true, free: false },
    { capacity: 8, bookable: true, free: true },
    { capacity: 12, bookable: false, free: true }
  ]
  it('frei, Warteliste, zu groß, aus', () => {
    expect(waitlistChoice(tables, 6, null, true)).toBe('free')
    expect(waitlistChoice(tables, 3, 0.5, true)).toBe('waitlist')
    expect(waitlistChoice(tables, 3, 0.5, false)).toBe('off')
    // Der 12er ist nicht buchbar - für 10 Personen gibt es also keinen Tisch.
    expect(waitlistChoice(tables, 10, null, true)).toBe('too-large')
  })
})
