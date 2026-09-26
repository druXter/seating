// app/lib/events/seat-rules.ts
import type { Layout } from '../floorplan/schema'
import { tableLabel, rowLabel } from '../floorplan/units'
import { tableSeatPositions } from '../floorplan/geometry'

/**
 * Reine Regeln für den Modus SEAT (docs/KONZEPT.md Abschnitt 1, Kino/Ball) - ohne Datenbank testbar:
 * welche Plätze nebeneinander liegen, Vorschlag "N nebeneinander", Prüfung einer Auswahl, Kurzform
 * der Platznamen.
 *
 * Nebeneinander heißt: in einem Reihenblock in derselben Reihe mit aufeinanderfolgenden Positionen,
 * ohne Gang oder ausgelassenen Platz dazwischen (ein "Abschnitt"); an einem Tisch beliebige Plätze
 * desselben Tisches (am Tisch sitzt man zusammen). Einzelne Stühle stehen für sich.
 *
 * Lückenregel (keine einzelne freie Lücke lassen, wie im Kino): fertig implementiert und getestet
 * (singleGapProblems), aber noch nicht eingeschaltet - siehe SeatRuleOptions.forbidSingleGaps. Zum
 * Nachrüsten genügt ein Event-Feld plus Checkbox, das den Wert an validateSeatSelection durchreicht.
 */

export const MAX_SEATS_RANGE = { min: 1, max: 50 } as const

export type SeatGroup = {
  kind: 'row' | 'table' | 'single'
  /** z.B. "Reihe A", "Parkett, Reihe B", "Tisch 3", "Einzelplätze" */
  label: string
  /** Abschnitte, innerhalb derer die Plätze in dieser Reihenfolge nebeneinander liegen. */
  segments: string[][]
}

/** Gruppen in Plan-Reihenfolge: Reihenblöcke (Reihe 1 = vorne zuerst), Tische, dann Einzelplätze. */
export function seatGroups(layout: Layout): SeatGroup[] {
  const groups: SeatGroup[] = []
  const singles: string[] = []
  for (const element of layout.elements) {
    if (element.type === 'seatBlock') {
      const omitted = new Set(element.omitted)
      const aisles = new Set(element.aisles)
      for (let row = 1; row <= element.rows; row++) {
        const segments: string[][] = []
        let current: string[] = []
        for (let position = 1; position <= element.seatsPerRow; position++) {
          if (omitted.has(`${row}-${position}`)) {
            if (current.length > 0) segments.push(current)
            current = []
            continue
          }
          current.push(`${element.id}-r${row}-s${position}`)
          if (aisles.has(position)) {
            segments.push(current)
            current = []
          }
        }
        if (current.length > 0) segments.push(current)
        const name = `Reihe ${rowLabel(element, row)}`
        if (segments.length > 0) groups.push({ kind: 'row', label: element.label ? `${element.label}, ${name}` : name, segments })
      }
    } else if (element.type === 'table') {
      const seats = tableSeatPositions(element).map((_, index) => `${element.id}-s${index + 1}`)
      if (seats.length > 0) groups.push({ kind: 'table', label: tableLabel(element), segments: [seats] })
    } else if (element.type === 'seat') {
      singles.push(element.id)
    }
  }
  if (singles.length > 0) groups.push({ kind: 'single', label: 'Einzelplätze', segments: singles.map(key => [key]) })
  return groups
}

/**
 * Erster Treffer für n Plätze nebeneinander unter den freien: in einer Reihe n aufeinanderfolgende
 * freie Plätze eines Abschnitts, an einem Tisch n freie Plätze desselben Tisches, bei n = 1 auch ein
 * Einzelplatz. null, wenn es keine gibt.
 */
export function suggestSeats(groups: readonly SeatGroup[], free: ReadonlySet<string>, n: number): string[] | null {
  if (!Number.isInteger(n) || n < 1) return null
  for (const group of groups) {
    if (group.kind === 'table') {
      const available = group.segments[0].filter(key => free.has(key))
      if (available.length >= n) return available.slice(0, n)
      continue
    }
    if (group.kind === 'single' && n > 1) continue
    for (const segment of group.segments) {
      let run: string[] = []
      for (const key of segment) {
        run = free.has(key) ? [...run, key] : []
        if (run.length === n) return run
      }
    }
  }
  return null
}

/** Die größte Gruppe, die überhaupt zusammensitzen kann (unabhängig von der Belegung). */
export function largestTogether(groups: readonly SeatGroup[], bookable: ReadonlySet<string>): number {
  let largest = 0
  for (const group of groups) {
    if (group.kind === 'table') {
      largest = Math.max(largest, group.segments[0].filter(key => bookable.has(key)).length)
      continue
    }
    for (const segment of group.segments) {
      let run = 0
      for (const key of segment) {
        run = bookable.has(key) ? run + 1 : 0
        largest = Math.max(largest, run)
      }
    }
  }
  return largest
}

/** Liegen diese Plätze nebeneinander (eine Reihe ohne Lücke oder ein Tisch)? */
export function seatsTogether(groups: readonly SeatGroup[], keys: readonly string[]): boolean {
  if (keys.length <= 1) return keys.length === 1
  const wanted = new Set(keys)
  for (const group of groups) {
    for (const segment of group.segments) {
      if (!keys.every(key => segment.includes(key))) continue
      if (group.kind === 'table') return true
      const indexes = segment.map((key, i) => (wanted.has(key) ? i : -1)).filter(i => i >= 0)
      return indexes[indexes.length - 1] - indexes[0] === keys.length - 1
    }
  }
  return false
}

/**
 * Lückenregel: Würde die Auswahl in einer Reihe einen einzelnen freien Platz übrig lassen, der links
 * und rechts von belegten Plätzen (oder Abschnittsende) eingeschlossen ist und direkt an einen
 * gewählten Platz grenzt? Gibt die betroffenen Plätze zurück. Tische und Einzelplätze sind ausgenommen.
 * occupied: belegt oder nicht buchbar, OHNE die Auswahl.
 */
export function singleGapProblems(groups: readonly SeatGroup[], occupied: ReadonlySet<string>, selected: ReadonlySet<string>): string[] {
  const gaps: string[] = []
  for (const group of groups) {
    if (group.kind !== 'row') continue
    for (const segment of group.segments) {
      if (segment.length < 2) continue
      const taken = (i: number) => i < 0 || i >= segment.length || occupied.has(segment[i]) || selected.has(segment[i])
      segment.forEach((key, i) => {
        if (taken(i)) return
        const nextToSelection = selected.has(segment[i - 1]) || selected.has(segment[i + 1])
        if (nextToSelection && taken(i - 1) && taken(i + 1)) gaps.push(key)
      })
    }
  }
  return gaps
}

export type SeatRuleOptions = {
  maxSeats: number | null
  /** Lückenregel (noch nicht als Event-Einstellung angeboten, siehe oben). */
  forbidSingleGaps: boolean
}

export type SeatState = 'free' | 'taken' | 'unavailable'

/**
 * Prüft eine Auswahl von Plätzen. states: Zustand jeder Platz-Einheit des Events (ohne die eigene
 * Buchung - deren Plätze gelten bei Änderungen als frei). labels für verständliche Meldungen.
 */
export function validateSeatSelection(
  keys: readonly string[], states: ReadonlyMap<string, SeatState>, labels: ReadonlyMap<string, string>,
  groups: readonly SeatGroup[], options: SeatRuleOptions
): string[] {
  const errors: string[] = []
  const unique = new Set(keys)
  if (unique.size === 0) return ['Bitte wähle mindestens einen Platz.']
  if (unique.size !== keys.length) errors.push('Ein Platz ist doppelt gewählt.')
  if (options.maxSeats !== null && unique.size > options.maxSeats) errors.push(`Pro Buchung sind höchstens ${options.maxSeats} Plätze möglich.`)
  for (const key of unique) {
    const state = states.get(key)
    if (state === undefined) errors.push('Diesen Platz gibt es nicht.')
    else if (state === 'unavailable') errors.push(`${labels.get(key) ?? key} ist nicht buchbar.`)
    else if (state === 'taken') errors.push(`${labels.get(key) ?? key} ist schon vergeben.`)
  }
  if (errors.length === 0 && options.forbidSingleGaps) {
    const occupied = new Set([...states].filter(([, state]) => state !== 'free').map(([key]) => key))
    const gaps = singleGapProblems(groups, occupied, unique)
    if (gaps.length > 0) errors.push(`Bitte lass keinen einzelnen Platz frei (${gaps.map(key => labels.get(key) ?? key).join(', ')}).`)
  }
  return [...new Set(errors)]
}

/**
 * Kurzform für Mails, Kalender und Listen: "Reihe A, Plätze 3–5, 7; Tisch 2, Platz 4". Erwartet die
 * Beschriftungen der Einheiten ("…, Platz N"); andere stehen unverändert da.
 */
export function compactSeatLabels(labels: readonly string[]): string {
  const groups = new Map<string, number[]>()
  const others: string[] = []
  for (const label of labels) {
    const match = /^(.*), Platz (\d+)$/.exec(label)
    if (!match) {
      others.push(label)
      continue
    }
    const numbers = groups.get(match[1]) ?? []
    numbers.push(Number(match[2]))
    groups.set(match[1], numbers)
  }
  const parts = [...groups].map(([prefix, numbers]) => {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b)
    const ranges: string[] = []
    for (let i = 0; i < sorted.length; i++) {
      let j = i
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
      ranges.push(j > i + 1 ? `${sorted[i]}–${sorted[j]}` : j === i + 1 ? `${sorted[i]}, ${sorted[j]}` : String(sorted[i]))
      i = j
    }
    return `${prefix}, ${sorted.length === 1 ? 'Platz' : 'Plätze'} ${ranges.join(', ')}`
  })
  return [...parts, ...others].join('; ')
}

/** Schlüssel einer Platz-Einheit (app/lib/floorplan/units.ts): t12-s3, s5, blk1-r2-s12. */
export const SEAT_KEY = /^(t[1-9][0-9]{0,5}-s[1-9][0-9]{0,2}|s[1-9][0-9]{0,5}|blk[1-9][0-9]{0,5}-r[1-9][0-9]{0,2}-s[1-9][0-9]{0,2})$/

/** Gewählte Plätze aus einem Formular (Feld unitKey, mehrfach). Unbekannte Formen fallen weg. */
export function formSeatKeys(formData: FormData): string[] {
  return formData.getAll('unitKey')
    .filter((value): value is string => typeof value === 'string' && SEAT_KEY.test(value))
    .slice(0, MAX_SEATS_RANGE.max * 4)
}

/**
 * Lückenregel für alle Events - vorbereitet, noch nicht als Event-Einstellung angeboten. Zum Nachrüsten:
 * Event-Feld (z.B. forbidSingleGaps) und Checkbox ergänzen und hier dessen Wert zurückgeben.
 */
export function gapRuleFor(event: object): boolean {
  void event
  return false
}
