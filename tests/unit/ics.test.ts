import { describe, expect, it } from 'vitest'
import { buildIcs, escapeText, foldLine, formatUtc } from '../../app/lib/ics'

const base = {
  method: 'PUBLISH' as const, uid: 'booking-abc@plaetze.example', sequence: 2,
  start: new Date('2026-12-12T18:00:00Z'), end: new Date('2026-12-12T22:30:00Z'), stamp: new Date('2026-11-01T10:15:30.123Z'),
  summary: 'Winterball 2026'
}

describe('escapeText', () => {
  it('escaped Backslash, Semikolon, Komma und Zeilenumbrüche, entfernt Steuerzeichen', () => {
    expect(escapeText('a\\b;c,d\r\ne\nf\u0007g')).toBe('a\\\\b\\;c\\,d\\ne\\nfg')
  })
})

describe('foldLine', () => {
  const octets = (line: string) => Buffer.byteLength(line, 'utf8')

  it('lässt kurze Zeilen unverändert', () => {
    expect(foldLine('SUMMARY:kurz')).toBe('SUMMARY:kurz')
  })

  it('faltet nach 75 Oktetten, Folgezeilen mit Leerzeichen', () => {
    const folded = foldLine('DESCRIPTION:' + 'x'.repeat(200)).split('\r\n')
    expect(folded.length).toBeGreaterThan(2)
    for (const line of folded) expect(octets(line)).toBeLessThanOrEqual(75)
    expect(folded.slice(1).every(line => line.startsWith(' '))).toBe(true)
    expect(folded.map((line, i) => (i === 0 ? line : line.slice(1))).join('')).toBe('DESCRIPTION:' + 'x'.repeat(200))
  })

  it('zerschneidet keine Umlaute oder Emoji', () => {
    const value = 'SUMMARY:' + 'Grüße 🎉 aus Köln – '.repeat(10)
    const folded = foldLine(value).split('\r\n')
    for (const line of folded) {
      expect(octets(line)).toBeLessThanOrEqual(75)
      expect(line).not.toContain('�')
    }
    expect(folded.map((line, i) => (i === 0 ? line : line.slice(1))).join('')).toBe(value)
  })
})

describe('buildIcs', () => {
  it('erzeugt eine gültige Datei mit CRLF, UID, SEQUENCE, UTC-Zeiten', () => {
    const ics = buildIcs({ ...base, location: 'Festsaal, Hauptstraße 1', description: 'Tisch 5 · 4 Personen\nLink: https://x/b/1/t', url: 'https://x/b/1/t' })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
    const unfolded = ics.replace(/\r\n /g, '')
    for (const line of [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:PUBLISH', 'UID:booking-abc@plaetze.example', 'SEQUENCE:2',
      'DTSTAMP:20261101T101530Z', 'DTSTART:20261212T180000Z', 'DTEND:20261212T223000Z', 'SUMMARY:Winterball 2026',
      'LOCATION:Festsaal\\, Hauptstraße 1', 'DESCRIPTION:Tisch 5 · 4 Personen\\nLink: https://x/b/1/t', 'URL:https://x/b/1/t',
      'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR'
    ]) expect(unfolded.split('\r\n'), line).toContain(line)
  })

  it('Storno: METHOD:CANCEL und STATUS:CANCELLED, gleiche UID', () => {
    const ics = buildIcs({ ...base, method: 'CANCEL', sequence: 3 })
    expect(ics).toContain('METHOD:CANCEL\r\n')
    expect(ics).toContain('STATUS:CANCELLED\r\n')
    expect(ics).toContain('UID:booking-abc@plaetze.example\r\n')
    expect(ics).toContain('SEQUENCE:3\r\n')
  })

  it('kein Einschleusen weiterer Eigenschaften über Texte', () => {
    const ics = buildIcs({ ...base, summary: 'Fest\r\nATTENDEE:mailto:x@y', url: 'https://x\r\nATTACH:evil' })
    expect(ics.split('\r\n').some(line => line.startsWith('ATTENDEE') || line.startsWith('ATTACH'))).toBe(false)
  })

  it('formatUtc', () => {
    expect(formatUtc(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z')
  })
})
