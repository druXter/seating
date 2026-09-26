import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDeadline, formatRange, utcToZonedInput, zonedInputToUtc } from '../../app/lib/timezone'

describe('zonedInputToUtc', () => {
  it('rechnet Winter- und Sommerzeit in Berlin um', () => {
    expect(zonedInputToUtc('2026-12-12T19:00')?.toISOString()).toBe('2026-12-12T18:00:00.000Z')
    expect(zonedInputToUtc('2026-07-01T19:00')?.toISOString()).toBe('2026-07-01T17:00:00.000Z')
  })

  it('schiebt eine nicht existierende Uhrzeit (Frühjahr) eine Stunde vor', () => {
    // 29.03.2026, 02:30 gibt es in Berlin nicht - gemeint ist 03:30 Sommerzeit.
    expect(zonedInputToUtc('2026-03-29T02:30')?.toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it('nimmt bei doppelter Uhrzeit (Herbst) die spätere', () => {
    // 25.10.2026, 02:30 gibt es zweimal - die spätere ist 02:30 Winterzeit = 01:30 UTC.
    expect(zonedInputToUtc('2026-10-25T02:30')?.toISOString()).toBe('2026-10-25T01:30:00.000Z')
  })

  it('lehnt ungültige Eingaben ab', () => {
    for (const value of ['', '2026-02-31T10:00', '2026-13-01T10:00', '2026-01-01T24:00', '2026-01-01 10:00', '2026-01-01T10:00:00', 'morgen']) {
      expect(zonedInputToUtc(value), value).toBeNull()
    }
  })

  it('funktioniert mit anderen Zeitzonen', () => {
    expect(zonedInputToUtc('2026-12-12T19:00', 'America/New_York')?.toISOString()).toBe('2026-12-13T00:00:00.000Z')
  })
})

describe('utcToZonedInput', () => {
  it('ist die Umkehrung von zonedInputToUtc', () => {
    for (const value of ['2026-12-12T19:00', '2026-07-01T00:15', '2026-03-29T03:30', '2026-10-25T01:59']) {
      expect(utcToZonedInput(zonedInputToUtc(value) as Date)).toBe(value)
    }
  })
})

describe('Anzeige', () => {
  it('formatiert Zeitpunkte und Zeiträume in der Event-Zeitzone', () => {
    const start = new Date('2026-12-12T18:00:00Z')
    expect(formatDateTime(start)).toBe('Samstag, 12. Dezember 2026, 19:00 Uhr')
    expect(formatRange(start, new Date('2026-12-12T22:30:00Z'))).toBe('Samstag, 12. Dezember 2026, 19:00–23:30 Uhr')
    expect(formatRange(start, new Date('2026-12-13T02:00:00Z'))).toBe('Samstag, 12. Dezember 2026, 19:00 Uhr bis Sonntag, 13. Dezember 2026, 03:00 Uhr')
  })

  it('Frist am selben Tag kurz, sonst vollständig (Tagesgrenze in der Event-Zeitzone)', () => {
    const now = new Date('2026-12-12T22:30:00Z') // 23:30 in Berlin
    expect(formatDeadline(new Date('2026-12-12T22:50:00Z'), 'Europe/Berlin', now)).toBe('heute, 23:50 Uhr')
    expect(formatDeadline(new Date('2026-12-12T23:10:00Z'), 'Europe/Berlin', now)).toBe('Sonntag, 13. Dezember 2026, 00:10 Uhr')
  })
})
