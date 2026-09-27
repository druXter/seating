// app/lib/events/assign-rules.ts
import { formString } from '../form'
import { parseCsv } from '../csv'
import { BOOKING_LIMITS } from './booking-rules'
import type { SeatGroup } from './seat-rules'

/**
 * Reine Regeln der Sitzordnung im Modus ASSIGNED (docs/KONZEPT.md Abschnitt 8, Zuordnungsmodus) -
 * ohne Datenbank testbar: Gruppen und Personen aus Formular und CSV, Plätze für eine ganze Gruppe
 * ("Begleitungen zusammenhalten"), Markierung getrennt sitzender Gruppen. Die Abläufe stehen in
 * assign.ts.
 *
 * Eine Gruppe ist eine Buchung (source ADMIN, bestätigt, ohne Kontaktdaten), jede Person ein Attendee.
 */

/** Höchstens so viele Personen pro Gruppe, so viele Zeilen pro CSV-Import. */
export const MAX_PARTY = 50
export const MAX_IMPORT_ROWS = 2000
export const ATTENDEE_NAME_MAX = BOOKING_LIMITS.name

/** Steuerzeichen raus, Leerraum zusammenfassen. */
export function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

export type PartyInput = { name: string; persons: string[] }

/**
 * Personen aus einem Textfeld, eine pro Zeile. Leere Zeilen fallen weg. Fehler: zu lange Namen, zu
 * viele Personen.
 */
export function parsePersonLines(text: string, errors: string[]): string[] {
  const persons = text.split(/\r\n?|\n/).map(cleanName).filter(Boolean)
  if (persons.some(p => p.length > ATTENDEE_NAME_MAX)) errors.push(`Namen dürfen höchstens ${ATTENDEE_NAME_MAX} Zeichen lang sein.`)
  if (persons.length > MAX_PARTY) errors.push(`Eine Gruppe hat höchstens ${MAX_PARTY} Personen.`)
  return persons
}

/**
 * Formular "Gruppe anlegen": Gruppenname (optional - sonst der Name der ersten Person) und Personen,
 * eine pro Zeile.
 */
export function parsePartyForm(formData: FormData): { ok: true; input: PartyInput } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const persons = parsePersonLines(formString(formData, 'persons', 10_000), errors)
  if (persons.length === 0) errors.push('Bitte gib mindestens eine Person an (eine pro Zeile).')
  const groupName = cleanName(formString(formData, 'name', 200))
  if (groupName.length > BOOKING_LIMITS.name) errors.push(`Der Gruppenname darf höchstens ${BOOKING_LIMITS.name} Zeichen lang sein.`)
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] }
  return { ok: true, input: { name: groupName || persons[0], persons } }
}

export type PersonEdit = { id: string; name: string; remove: boolean }
export type PartyEdit = { name: string; persons: PersonEdit[]; added: string[] }

const ID = /^[a-z0-9]{10,40}$/

/**
 * Formular "Gruppe bearbeiten": Gruppenname, je Person "person:<id>" (Name) und "remove:<id>"
 * (entfernen), neue Personen als Zeilen in "added". Übrig bleiben muss mindestens eine Person.
 */
export function parsePartyEdit(formData: FormData): { ok: true; input: PartyEdit } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const name = cleanName(formString(formData, 'name', 200))
  if (!name) errors.push('Bitte gib einen Gruppennamen an.')
  if (name.length > BOOKING_LIMITS.name) errors.push(`Der Gruppenname darf höchstens ${BOOKING_LIMITS.name} Zeichen lang sein.`)
  const persons: PersonEdit[] = []
  for (const [field, value] of formData.entries()) {
    if (!field.startsWith('person:') || typeof value !== 'string') continue
    const id = field.slice('person:'.length)
    if (!ID.test(id) || persons.some(p => p.id === id)) continue
    const remove = formData.get(`remove:${id}`) === 'on'
    const personName = cleanName(value.slice(0, 1000))
    if (!remove && !personName) errors.push('Namen dürfen nicht leer sein – zum Entfernen „entfernen“ ankreuzen.')
    if (personName.length > ATTENDEE_NAME_MAX) errors.push(`Namen dürfen höchstens ${ATTENDEE_NAME_MAX} Zeichen lang sein.`)
    persons.push({ id, name: personName, remove })
  }
  const added = parsePersonLines(formString(formData, 'added', 10_000), errors)
  const remaining = persons.filter(p => !p.remove).length + added.length
  if (remaining === 0) errors.push('Eine Gruppe braucht mindestens eine Person. Die ganze Gruppe entfernst du unten mit „Absagen“ oder „Endgültig löschen“.')
  if (remaining > MAX_PARTY) errors.push(`Eine Gruppe hat höchstens ${MAX_PARTY} Personen.`)
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] }
  return { ok: true, input: { name, persons, added } }
}

// --- CSV-Import ----------------------------------------------------------------------------------

export type ImportParty = { name: string; persons: string[]; note: string | null }
export type GuestImport = { ok: true; parties: ImportParty[]; persons: number } | { ok: false; errors: string[] }

const COLUMN_NAMES = {
  name: ['name', 'gast', 'person'],
  group: ['gruppe', 'group', 'familie', 'einladung'],
  note: ['notiz', 'anmerkung', 'hinweis', 'note']
} as const

function column(header: string[], names: readonly string[]): number {
  return header.findIndex(cell => (names as readonly string[]).includes(cleanName(cell).toLocaleLowerCase('de')))
}

/**
 * Gästeliste als CSV: eine Zeile pro Person, erste Zeile mit Spaltennamen. Pflicht ist "Name";
 * "Gruppe" fasst Zeilen zu einer Gruppe zusammen (gleicher Wert, ohne Groß-/Kleinschreibung) - ohne
 * Gruppe ist jede Person eine eigene Gruppe. "Notiz" wird zur internen Notiz der Gruppe.
 * Ganz oder gar nicht: Bei einem Fehler wird nichts übernommen (die Meldungen nennen die Zeile).
 */
export function parseGuestCsv(text: string): GuestImport {
  const rows = parseCsv(text)
  if (rows.length === 0) return { ok: false, errors: ['Die Datei ist leer.'] }
  const [header, ...data] = rows
  const nameColumn = column(header, COLUMN_NAMES.name)
  if (nameColumn < 0) return { ok: false, errors: ['Die erste Zeile muss die Spaltennamen enthalten, mindestens „Name“ (dazu optional „Gruppe“ und „Notiz“).'] }
  const groupColumn = column(header, COLUMN_NAMES.group)
  const noteColumn = column(header, COLUMN_NAMES.note)
  if (data.length === 0) return { ok: false, errors: ['Die Datei enthält keine Gäste.'] }
  if (data.length > MAX_IMPORT_ROWS) return { ok: false, errors: [`Höchstens ${MAX_IMPORT_ROWS} Gäste pro Import.`] }

  const errors: string[] = []
  const parties = new Map<string, ImportParty & { notes: string[] }>()
  const order: (ImportParty & { notes: string[] })[] = []
  data.forEach((row, index) => {
    const line = index + 2
    const name = cleanName(row[nameColumn] ?? '')
    const group = groupColumn >= 0 ? cleanName(row[groupColumn] ?? '') : ''
    const note = noteColumn >= 0 ? cleanName(row[noteColumn] ?? '') : ''
    if (!name) return errors.push(`Zeile ${line}: Name fehlt.`)
    if (name.length > ATTENDEE_NAME_MAX) return errors.push(`Zeile ${line}: Name ist länger als ${ATTENDEE_NAME_MAX} Zeichen.`)
    if (group.length > BOOKING_LIMITS.name) return errors.push(`Zeile ${line}: Gruppe ist länger als ${BOOKING_LIMITS.name} Zeichen.`)
    const key = group ? group.toLocaleLowerCase('de') : null
    let party = key ? parties.get(key) : undefined
    if (!party) {
      party = { name: group || name, persons: [], note: null, notes: [] }
      if (key) parties.set(key, party)
      order.push(party)
    }
    party.persons.push(name)
    if (note && !party.notes.includes(note)) party.notes.push(note)
    if (party.persons.length === MAX_PARTY + 1) errors.push(`Gruppe „${party.name}“: höchstens ${MAX_PARTY} Personen.`)
  })
  if (errors.length > 0) return { ok: false, errors: errors.length > 20 ? [...errors.slice(0, 20), `… und ${errors.length - 20} weitere Fehler.`] : errors }
  const result = order.map(({ notes, ...party }) => ({ ...party, note: notes.length > 0 ? notes.join('; ').slice(0, 1000) : null }))
  return { ok: true, parties: result, persons: result.reduce((sum, p) => sum + p.persons.length, 0) }
}

// --- Plätze -------------------------------------------------------------------------------------

/**
 * Plätze für n Personen einer Gruppe, die zusammensitzen sollen, ab dem Zielplatz: an einem Tisch der
 * Zielplatz und die folgenden freien Plätze desselben Tisches (reihum); in einer Reihe n freie Plätze
 * nebeneinander im selben Abschnitt, die den Zielplatz enthalten - bevorzugt ab ihm nach rechts; ein
 * Einzelplatz nur für eine Person. null, wenn es so nicht passt (der Zielplatz muss frei sein).
 */
export function partySeats(groups: readonly SeatGroup[], free: ReadonlySet<string>, target: string, n: number): string[] | null {
  if (!Number.isInteger(n) || n < 1 || !free.has(target)) return null
  for (const group of groups) {
    for (const segment of group.segments) {
      const at = segment.indexOf(target)
      if (at < 0) continue
      if (group.kind === 'table') {
        const around = [...segment.slice(at), ...segment.slice(0, at)].filter(key => free.has(key))
        return around.length >= n ? around.slice(0, n) : null
      }
      if (group.kind === 'single') return n === 1 ? [target] : null
      for (let start = at; start > at - n; start--) {
        if (start < 0 || start + n > segment.length) continue
        const window = segment.slice(start, start + n)
        if (window.every(key => free.has(key))) return window
      }
      return null
    }
  }
  return null
}

/** Gruppe (Tisch, Reihe) eines Platzes - Einzelplätze zählen jeder für sich. */
export function groupOfSeat(groups: readonly SeatGroup[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const group of groups) {
    for (const segment of group.segments) {
      for (const key of segment) result.set(key, group.kind === 'single' ? `single:${key}` : group.label)
    }
  }
  return result
}

/**
 * Wo sitzt eine Gruppe? Die verschiedenen Tische/Reihen in Reihenfolge des ersten Auftretens. Mehr als
 * einer: getrennt (Markierung in der Gästeliste). Plätze in derselben Reihe, aber durch einen Gang
 * getrennt, gelten als zusammen - dieselbe Reihe ist nah genug.
 */
export function partySpread(seatKeys: readonly string[], groupOf: ReadonlyMap<string, string>): string[] {
  return [...new Set(seatKeys.map(key => groupOf.get(key) ?? key))]
}

/** Initialen für einen Platz im Plan: "Erika Muster" -> "EM", "Oma" -> "Om". */
export function initials(name: string): string {
  const words = cleanName(name).split(' ').filter(word => /\p{L}|\p{N}/u.test(word))
  if (words.length === 0) return '?'
  const first = (word: string) => [...word.replace(/^[^\p{L}\p{N}]+/u, '')][0] ?? ''
  if (words.length === 1) return [...words[0]].slice(0, 2).join('')
  return (first(words[0]) + first(words[words.length - 1])).toLocaleUpperCase('de')
}
