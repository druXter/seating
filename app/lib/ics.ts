// app/lib/ics.ts

/**
 * Kalenderdatei (RFC 5545) für eine Buchung - bewusst ohne Bibliothek, weil wir genau diese Teile
 * brauchen (docs/KONZEPT.md Abschnitt 7):
 *
 * - UID booking-<id>@<host>, stabil über alle Änderungen, SEQUENCE aus Booking.icsSequence -
 *   Kalender erkennen eine neue Datei so als Update desselben Eintrags.
 * - METHOD:PUBLISH (kein REQUEST - sonst behandeln Clients sie als Einladung mit Antwort an den
 *   Organisator); Storno mit METHOD:CANCEL und STATUS:CANCELLED.
 * - Zeiten in UTC (...Z), CRLF-Zeilenenden, Zeilen nach 75 Oktetten gefaltet (ohne UTF-8-Zeichen
 *   zu zerschneiden), Text mit \, ; , und Zeilenumbrüchen escaped.
 */

export type IcsInput = {
  method: 'PUBLISH' | 'CANCEL'
  uid: string
  sequence: number
  start: Date
  end: Date
  stamp: Date
  summary: string
  location?: string
  description?: string
  url?: string
}

/** Text-Werte: Backslash, Semikolon, Komma und Zeilenumbrüche escapen, Steuerzeichen entfernen. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Faltet eine Inhaltszeile nach höchstens 75 Oktetten (UTF-8). Folgezeilen beginnen mit einem
 * Leerzeichen, das mitzählt. Mehrbyte-Zeichen (Umlaute, Emoji) werden nie zerschnitten.
 */
export function foldLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let bytes = 0
  let limit = 75
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8')
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
      limit = 74 // Folgezeilen: 1 Oktett für das führende Leerzeichen
    }
    current += char
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** 20261212T180000Z */
export function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function buildIcs(input: IcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Seating//Buchung//DE',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `SEQUENCE:${Math.max(0, Math.floor(input.sequence))}`,
    `DTSTAMP:${formatUtc(input.stamp)}`,
    `DTSTART:${formatUtc(input.start)}`,
    `DTEND:${formatUtc(input.end)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    ...(input.description ? [`DESCRIPTION:${escapeText(input.description)}`] : []),
    // URL ist vom Typ URI - nicht als Text escapen, nur Zeilenumbrüche ausschließen.
    ...(input.url ? [`URL:${input.url.replace(/[\r\n]/g, '')}`] : []),
    `STATUS:${input.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR'
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
