import { describe, expect, it } from 'vitest'
import { parseEventForm } from '../../../app/lib/events/settings'

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const valid = {
  title: '  Winterball 2026 ', slug: 'winterball-2026', startsAt: '2026-12-12T19:00', endsAt: '2026-12-13T01:00',
  location: 'Festsaal', description: 'Zeile 1\r\nZeile 2\u0007'
}

describe('parseEventForm', () => {
  it('übernimmt gültige Werte, Zeiten in UTC', () => {
    const result = parseEventForm(form(valid))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.status).toBeNull()
    expect(result.fields).toMatchObject({
      title: 'Winterball 2026', slug: 'winterball-2026', mode: 'TABLE', location: 'Festsaal', description: 'Zeile 1\nZeile 2',
      minFillRatio: null, bookingOpensAt: null, bookingClosesAt: null
    })
    expect(result.fields.startsAt.toISOString()).toBe('2026-12-12T18:00:00.000Z')
  })

  it('verlangt Titel, gültige Adresse und Zeiten in richtiger Reihenfolge', () => {
    const result = parseEventForm(form({ ...valid, title: '', slug: 'admin', endsAt: '2026-12-12T18:00' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/Titel/)
    expect(result.errors.join(' ')).toMatch(/reserviert/)
    expect(result.errors.join(' ')).toMatch(/Ende muss nach dem Beginn/)
  })

  it('lehnt noch nicht verfügbare Modi und unbekannte Status ab', () => {
    const extras: Record<string, string>[] = [{ mode: 'ASSIGNED' }, { mode: 'X' }, { status: 'DELETED' }]
    for (const extra of extras) {
      expect(parseEventForm(form({ ...valid, ...extra })).ok, JSON.stringify(extra)).toBe(false)
    }
  })

  it('liest Status, Buchungszeitraum und Mindestbelegung', () => {
    const result = parseEventForm(form({
      ...valid, status: 'OPEN', bookingOpensAt: '2026-11-01T10:00', bookingClosesAt: '2026-12-10T23:59', minFillPercent: '50'
    }))
    expect(result.ok && result.status).toBe('OPEN')
    expect(result.ok && result.fields.minFillRatio).toBe(0.5)
  })

  it('lehnt ungültige Mindestbelegung und verdrehten Buchungszeitraum ab', () => {
    for (const minFillPercent of ['0', '101', '12.5', 'viel']) {
      expect(parseEventForm(form({ ...valid, minFillPercent })).ok, minFillPercent).toBe(false)
    }
    expect(parseEventForm(form({ ...valid, bookingOpensAt: '2026-12-10T10:00', bookingClosesAt: '2026-12-01T10:00' })).ok).toBe(false)
  })
})

describe('Buchungs-Einstellungen', () => {
  const settings = { pendingTtlMinutes: '45', selfEditHoursBefore: '0', oneBookingPerEmail: 'on', replyTo: ' Info@Verein.DE ', mailNote: 'Einlass 18:30', offerTtlHours: '12', maxSeatsPerBooking: '6' }

  it('nur im Einstellungsformular - beim Anlegen null', () => {
    const created = parseEventForm(form(valid))
    expect(created.ok && created.booking).toBeNull()
    const result = parseEventForm(form({ ...valid, ...settings }))
    expect(result.ok && result.booking).toEqual({
      pendingTtlMinutes: 45, selfEditHoursBefore: 0, oneBookingPerEmail: true, requirePhone: false, replyTo: 'info@verein.de', mailNote: 'Einlass 18:30',
      waitlistEnabled: false, offerTtlHours: 12, maxSeatsPerBooking: 6
    })
    const withWaitlist = parseEventForm(form({ ...valid, ...settings, waitlistEnabled: 'on' }))
    expect(withWaitlist.ok && withWaitlist.booking && withWaitlist.booking.waitlistEnabled).toBe(true)
  })

  it('lehnt Werte außerhalb der Grenzen und ungültige Antwortadressen ab', () => {
    for (const patch of [{ pendingTtlMinutes: '4' }, { pendingTtlMinutes: '1441' }, { selfEditHoursBefore: '-1' }, { selfEditHoursBefore: '337' }, { replyTo: 'keine-adresse' }, { offerTtlHours: '0' }, { offerTtlHours: '169' }, { maxSeatsPerBooking: '0' }, { maxSeatsPerBooking: '51' }]) {
      expect(parseEventForm(form({ ...valid, ...settings, ...patch })).ok, JSON.stringify(patch)).toBe(false)
    }
  })
})
