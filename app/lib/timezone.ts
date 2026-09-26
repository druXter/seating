// app/lib/timezone.ts

/**
 * Events speichern Zeiten in UTC, eingegeben und angezeigt werden sie in der Zeitzone des Events
 * (Event.timezone, vorerst immer Europe/Berlin). Ohne Zusatzbibliothek über Intl - der Server kann
 * dabei in jeder Zeitzone laufen, maßgeblich ist nur die des Events.
 */

export const DEFAULT_TIMEZONE = 'Europe/Berlin'

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** Abstand Ortszeit − UTC in Millisekunden zum Zeitpunkt utcMs. */
function offsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(utcMs))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/**
 * Wandelt "2026-12-12T19:00" (Wert eines datetime-local-Feldes, Ortszeit des Events) in einen
 * UTC-Zeitpunkt. Null bei ungültiger Eingabe (Format oder Datum wie 31.02.).
 *
 * Zeitumstellung: Eine Uhrzeit, die es nicht gibt (Frühjahr, 02:30), rutscht eine Stunde nach
 * vorn (03:30 Sommerzeit); eine doppelte (Herbst, 02:30) gilt als die spätere (Winterzeit).
 */
export function zonedInputToUtc(value: string, timeZone: string = DEFAULT_TIMEZONE): Date | null {
  const match = LOCAL_PATTERN.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(wall)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null

  let utc = wall - offsetAt(wall, timeZone)
  const corrected = offsetAt(utc, timeZone)
  if (corrected !== wall - utc) utc = wall - corrected
  return new Date(utc)
}

/** Umkehrung für den Startwert eines datetime-local-Feldes. */
export function utcToZonedInput(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const local = new Date(date.getTime() + offsetAt(date.getTime(), timeZone))
  return local.toISOString().slice(0, 16)
}

function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** "Samstag, 12. Dezember 2026, 19:00 Uhr" */
export function formatDateTime(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const day = new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  return `${day}, ${formatTime(date, timeZone)} Uhr`
}

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

/** Frist kurz angeben: am selben Tag "heute, 15:07 Uhr", sonst vollständig. */
export function formatDeadline(date: Date, timeZone: string = DEFAULT_TIMEZONE, now = new Date()): string {
  return dayKey(date, timeZone) === dayKey(now, timeZone) ? `heute, ${formatTime(date, timeZone)} Uhr` : formatDateTime(date, timeZone)
}

/**
 * Zeitraum eines Events: am selben Tag "Samstag, 12. Dezember 2026, 19:00–23:30 Uhr",
 * sonst beide Zeitpunkte vollständig.
 */
export function formatRange(start: Date, end: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  if (dayKey(start, timeZone) === dayKey(end, timeZone)) {
    return `${formatDateTime(start, timeZone).replace(/ Uhr$/, '')}–${formatTime(end, timeZone)} Uhr`
  }
  return `${formatDateTime(start, timeZone)} bis ${formatDateTime(end, timeZone)}`
}
