import { describe, expect, it } from 'vitest'
import { countStates, holdsUnits, publicState, tableFits, unitStates, type StateUnit } from '../../../app/lib/events/occupancy'

const now = new Date('2026-06-01T12:00:00Z')
const future = new Date('2026-06-01T12:30:00Z')
const past = new Date('2026-06-01T11:59:59Z')

const units: StateUnit[] = [
  { key: 't1', kind: 'TABLE', tableKey: null, bookable: true },
  { key: 't1-s1', kind: 'SEAT', tableKey: 't1', bookable: true },
  { key: 't1-s2', kind: 'SEAT', tableKey: 't1', bookable: true },
  { key: 't2', kind: 'TABLE', tableKey: null, bookable: true },
  { key: 't2-s1', kind: 'SEAT', tableKey: 't2', bookable: true },
  { key: 't2-s2', kind: 'SEAT', tableKey: 't2', bookable: true },
  { key: 't3', kind: 'TABLE', tableKey: null, bookable: false },
  { key: 's4', kind: 'SEAT', tableKey: null, bookable: true }
]

describe('holdsUnits', () => {
  it('bestätigt immer, PENDING/OFFERED nur bis expiresAt, andere nie', () => {
    expect(holdsUnits({ status: 'CONFIRMED', expiresAt: null }, now)).toBe(true)
    expect(holdsUnits({ status: 'PENDING', expiresAt: future }, now)).toBe(true)
    expect(holdsUnits({ status: 'OFFERED', expiresAt: future }, now)).toBe(true)
    expect(holdsUnits({ status: 'PENDING', expiresAt: past }, now)).toBe(false)
    expect(holdsUnits({ status: 'PENDING', expiresAt: now }, now)).toBe(false)
    expect(holdsUnits({ status: 'PENDING', expiresAt: null }, now)).toBe(false)
    for (const status of ['CANCELLED', 'EXPIRED', 'WAITLISTED'] as const) {
      expect(holdsUnits({ status, expiresAt: future }, now)).toBe(false)
    }
  })
})

describe('unitStates', () => {
  it('alles frei, nicht buchbare Einheiten als unavailable', () => {
    const states = unitStates(units, [], now)
    expect(states.get('t1')).toBe('free')
    expect(states.get('t3')).toBe('unavailable')
    expect(states.get('s4')).toBe('free')
  })

  it('ein belegter Tisch belegt seine Plätze, nicht andere', () => {
    const states = unitStates(units, [{ unitKey: 't1', status: 'CONFIRMED', expiresAt: null }], now)
    expect(states.get('t1')).toBe('confirmed')
    expect(states.get('t1-s1')).toBe('confirmed')
    expect(states.get('t1-s2')).toBe('confirmed')
    expect(states.get('t2')).toBe('free')
  })

  it('ein belegter Platz belegt seinen Tisch (gemischte Belegung)', () => {
    const states = unitStates(units, [{ unitKey: 't2-s1', status: 'PENDING', expiresAt: future }], now)
    expect(states.get('t2')).toBe('held')
    expect(states.get('t2-s1')).toBe('held')
    expect(states.get('t1')).toBe('free')
    // Die übrigen Plätze am Tisch bleiben frei.
    expect(states.get('t2-s2')).toBe('free')
  })

  it('ein belegter Tisch belegt alle seine Plätze', () => {
    const states = unitStates(units, [{ unitKey: 't1', status: 'CONFIRMED', expiresAt: null }], now)
    expect(states.get('t1-s1')).toBe('confirmed')
    expect(states.get('t1-s2')).toBe('confirmed')
  })

  it('ignoriert abgelaufene Holds schon beim Lesen', () => {
    const states = unitStates(units, [{ unitKey: 't1', status: 'PENDING', expiresAt: past }], now)
    expect(states.get('t1')).toBe('free')
  })

  it('bestätigt schlägt reserviert', () => {
    const states = unitStates(units, [
      { unitKey: 't1-s1', status: 'PENDING', expiresAt: future },
      { unitKey: 't1-s2', status: 'CONFIRMED', expiresAt: null }
    ], now)
    expect(states.get('t1')).toBe('confirmed')
    // Jeder Platz behält seinen eigenen Zustand - Plätze an einem Tisch werden einzeln vergeben (SEAT).
    expect(states.get('t1-s1')).toBe('held')
    expect(states.get('t1-s2')).toBe('confirmed')
  })

  it('eine belegte, nicht buchbare Einheit zeigt die Belegung', () => {
    const states = unitStates(units, [{ unitKey: 't3', status: 'CONFIRMED', expiresAt: null }], now)
    expect(states.get('t3')).toBe('confirmed')
  })

  it('öffentlich sind bestätigt und reserviert nicht unterscheidbar', () => {
    expect(publicState('confirmed')).toBe('occupied')
    expect(publicState('held')).toBe('occupied')
    expect(publicState('free')).toBe('free')
    expect(publicState('unavailable')).toBe('unavailable')
  })

  it('zählt je Art', () => {
    const states = unitStates(units, [
      { unitKey: 't1', status: 'CONFIRMED', expiresAt: null },
      { unitKey: 't2', status: 'PENDING', expiresAt: future }
    ], now)
    expect(countStates(units, states, 'TABLE')).toEqual({ free: 0, held: 1, confirmed: 1, unavailable: 1 })
  })
})

describe('tableFits', () => {
  it('ohne Mindestbelegung: 1 bis Kapazität', () => {
    expect(tableFits(8, 1, null)).toBe(true)
    expect(tableFits(8, 8, null)).toBe(true)
    expect(tableFits(8, 9, null)).toBe(false)
    expect(tableFits(8, 0, null)).toBe(false)
    expect(tableFits(8, 2.5, null)).toBe(false)
    expect(tableFits(0, 1, null)).toBe(false)
  })

  it('mit Mindestbelegung: aufgerundet, ohne Rundungsfehler', () => {
    expect(tableFits(8, 3, 0.5)).toBe(false)
    expect(tableFits(8, 4, 0.5)).toBe(true)
    expect(tableFits(7, 3, 0.5)).toBe(false)
    expect(tableFits(7, 4, 0.5)).toBe(true)
    // 10 × 0.3 = 3.0000000000000004 in Gleitkomma - darf nicht zu "ab 4" werden.
    expect(tableFits(10, 3, 0.3)).toBe(true)
    expect(tableFits(10, 10, 1)).toBe(true)
    expect(tableFits(10, 9, 1)).toBe(false)
  })
})
