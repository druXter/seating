import { describe, expect, it } from 'vitest'
import { bookingWindow, canSelfEdit, parseReservation, selfEditDeadline } from '../../../app/lib/events/booking-rules'

const event = {
  status: 'OPEN' as const, mode: 'TABLE' as const, access: 'OPEN' as const, timezone: 'Europe/Berlin',
  startsAt: new Date('2026-12-12T18:00:00Z'), endsAt: new Date('2026-12-12T23:00:00Z'),
  bookingOpensAt: null as Date | null, bookingClosesAt: null as Date | null
}
const at = (iso: string) => new Date(iso)

describe('bookingWindow', () => {
  it('offen bis Beginn', () => {
    expect(bookingWindow(event, at('2026-12-01T10:00:00Z')).open).toBe(true)
    expect(bookingWindow(event, at('2026-12-12T18:00:00Z')).open).toBe(false)
  })

  it('beachtet Buchungszeitraum, Status, Modus und Ende', () => {
    const now = at('2026-12-01T10:00:00Z')
    const notYet = bookingWindow({ ...event, bookingOpensAt: at('2026-12-05T09:00:00Z') }, now)
    expect(notYet).toEqual({ open: false, message: 'Buchen kannst du ab Samstag, 5. Dezember 2026, 10:00 Uhr.' })
    expect(bookingWindow({ ...event, bookingClosesAt: at('2026-11-30T00:00:00Z') }, now).open).toBe(false)
    expect(bookingWindow({ ...event, status: 'CLOSED' }, now).open).toBe(false)
    expect(bookingWindow({ ...event, status: 'DRAFT' }, now).open).toBe(false)
    expect(bookingWindow({ ...event, mode: 'SEAT' }, now).open).toBe(false)
    expect(bookingWindow({ ...event, access: 'RSVP' }, now).open).toBe(false)
    expect(bookingWindow(event, at('2026-12-13T00:00:00Z'))).toEqual({ open: false, message: 'Diese Veranstaltung hat bereits stattgefunden.' })
  })
})

describe('Änderungsfrist', () => {
  it('startsAt minus Stunden, 0 = bis Beginn', () => {
    expect(selfEditDeadline({ startsAt: event.startsAt, selfEditHoursBefore: 24 }).toISOString()).toBe('2026-12-11T18:00:00.000Z')
    expect(canSelfEdit({ startsAt: event.startsAt, selfEditHoursBefore: 24 }, at('2026-12-11T17:59:59Z'))).toBe(true)
    expect(canSelfEdit({ startsAt: event.startsAt, selfEditHoursBefore: 24 }, at('2026-12-11T18:00:00Z'))).toBe(false)
    expect(canSelfEdit({ startsAt: event.startsAt, selfEditHoursBefore: 0 }, at('2026-12-12T17:59:00Z'))).toBe(true)
  })
})

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const valid = { name: '  Erika  Muster ', email: 'Erika@Example.DE', partySize: '4', partySizeConfirm: '4', unitKey: 't12', privacy: 'on', note: 'Rollstuhl\r\nPlatz' }

describe('parseReservation', () => {
  it('übernimmt und normalisiert gültige Angaben', () => {
    const result = parseReservation(form(valid), false)
    expect(result).toEqual({ ok: true, input: { name: 'Erika Muster', email: 'erika@example.de', partySize: 4, unitKey: 't12', phone: null, note: 'Rollstuhl\nPlatz' } })
  })

  it('verlangt übereinstimmende Personenzahl, Datenschutzhinweis, gültigen Tisch', () => {
    for (const patch of [{ partySizeConfirm: '5' }, { privacy: '' }, { unitKey: 't12-s1' }, { unitKey: 'blk1' }, { partySize: '0', partySizeConfirm: '0' }, { email: 'kein@' }, { name: ' ' }]) {
      expect(parseReservation(form({ ...valid, ...patch }), false).ok, JSON.stringify(patch)).toBe(false)
    }
  })

  it('Telefon: Pflicht nur wenn verlangt, Format geprüft', () => {
    expect(parseReservation(form(valid), true).ok).toBe(false)
    expect(parseReservation(form({ ...valid, phone: '+49 (0)261 123-456' }), true).ok).toBe(true)
    expect(parseReservation(form({ ...valid, phone: '<script>' }), false).ok).toBe(false)
  })
})
