// app/lib/events/admin-rules.ts
import type { BookingSource, BookingStatus } from '@prisma/client'
import { formString, normalizeEmail } from '../form'
import { holdsUnits } from './occupancy'
import { parseContact, parsePartySize, type ContactFields } from './booking-rules'

/**
 * Reine Regeln der Buchungsverwaltung durch Veranstalter*innen (docs/KONZEPT.md Abschnitt 8) - ohne
 * Datenbank testbar. Die Abläufe selbst stehen in admin-booking.ts.
 */

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: 'unbestätigt', CONFIRMED: 'bestätigt', CANCELLED: 'storniert', EXPIRED: 'verfallen', WAITLISTED: 'Warteliste', OFFERED: 'Angebot'
}

export const BOOKING_SOURCE_LABELS: Record<BookingSource, string> = { PUBLIC: 'online', RSVP: 'rsvp-app', ADMIN: 'Veranstalter*in' }

export const ADMIN_NOTE_MAX = 1000

type StatusLike = { status: BookingStatus; expiresAt: Date | null }

/** Anzeige-Status: ein abgelaufener Hold gilt schon beim Lesen als verfallen (Konzept Abschnitt 5). */
export function effectiveStatus(booking: StatusLike, now: Date): BookingStatus {
  if ((booking.status === 'PENDING' || booking.status === 'OFFERED') && !holdsUnits(booking, now)) return 'EXPIRED'
  return booking.status
}

// --- Liste ------------------------------------------------------------------------------------

export const LIST_FILTERS = ['active', 'confirmed', 'pending', 'cancelled', 'expired', 'all'] as const
export type ListFilter = (typeof LIST_FILTERS)[number]

export const LIST_FILTER_LABELS: Record<ListFilter, string> = {
  active: 'aktiv', confirmed: 'bestätigt', pending: 'unbestätigt', cancelled: 'storniert', expired: 'verfallen', all: 'alle'
}

export function parseListFilter(value: string | undefined): ListFilter {
  return LIST_FILTERS.includes(value as ListFilter) ? (value as ListFilter) : 'active'
}

export function matchesListFilter(booking: StatusLike, filter: ListFilter, now: Date): boolean {
  const status = effectiveStatus(booking, now)
  switch (filter) {
    case 'all': return true
    case 'active': return status === 'CONFIRMED' || status === 'PENDING' || status === 'OFFERED'
    case 'confirmed': return status === 'CONFIRMED'
    case 'pending': return status === 'PENDING'
    case 'cancelled': return status === 'CANCELLED'
    case 'expired': return status === 'EXPIRED'
  }
}

/** Freitextsuche über Name, E-Mail, Telefon und Tisch - ohne Groß-/Kleinschreibung, mit Umlauten. */
export function matchesSearch(booking: { name: string; email: string | null; phone: string | null; tables: string[] }, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('de')
  if (!needle) return true
  return [booking.name, booking.email ?? '', booking.phone ?? '', ...booking.tables].some(value => value.toLocaleLowerCase('de').includes(needle))
}

// --- Tischregeln --------------------------------------------------------------------------------

/**
 * Für Veranstalter*innen gilt die Kapazität, nicht die Mindestbelegung (minFillRatio): Eine kleine
 * Gruppe an einen großen Tisch zu setzen, ist ihre Entscheidung. Mehr Personen als Plätze gehen nicht -
 * darauf verlässt sich die Planprüfung (app/lib/events/save-layout.ts). Wer einen Stuhl mehr braucht,
 * ändert den Tisch im Plan.
 */
export function adminTableProblem(table: { label: string; capacity: number }, partySize: number): string | null {
  if (partySize > table.capacity) return `${table.label} hat nur ${table.capacity} Plätze. Für mehr Personen den Tisch im Plan vergrößern.`
  return null
}

// --- Formulare ----------------------------------------------------------------------------------

export function formFlag(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on'
}

/** Stand, auf dem ein Formular aufbaut (Booking.updatedAt) - Konflikterkennung bei gleichzeitigen Änderungen. */
export function parseUpdatedAt(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseUnitKey(formData: FormData, errors: string[]): string {
  const unitKey = formString(formData, 'unitKey', 40)
  if (!/^t[1-9][0-9]{0,5}$/.test(unitKey)) errors.push('Bitte wähle einen Tisch.')
  return unitKey
}

export type AdminChangeInput = ContactFields & { partySize: number; unitKey: string }

/** Ändern-Formular: Kontakt (Telefon nie Pflicht - das entscheiden Veranstalter*innen), Personen, Tisch. */
export function parseAdminChange(formData: FormData): { ok: true; input: AdminChangeInput } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const contact = parseContact(formData, false, errors)
  const partySize = parsePartySize(formString(formData, 'partySize', 5))
  if (partySize === null) errors.push('Bitte gib die Personenzahl an.')
  const unitKey = parseUnitKey(formData, errors)
  if (errors.length > 0 || partySize === null) return { ok: false, errors }
  return { ok: true, input: { ...contact, partySize, unitKey } }
}

export type AdminCreateInput = AdminChangeInput & { email: string | null; confirm: 'direct' | 'verify'; notify: boolean; adminNote: string | null }

/**
 * Buchung anlegen (z.B. telefonische Reservierung). E-Mail optional - ohne Adresse ist die Buchung
 * direkt bestätigt und bekommt keine Mails. "verify": Bestätigung per Mail wie bei einer Online-Buchung.
 */
export function parseAdminCreate(formData: FormData): { ok: true; input: AdminCreateInput } | { ok: false; errors: string[] } {
  const base = parseAdminChange(formData)
  const errors = base.ok ? [] : [...base.errors]
  const emailInput = formString(formData, 'email', 254)
  const email = emailInput ? normalizeEmail(emailInput) : null
  if (emailInput && !email) errors.push('Die E-Mail-Adresse sieht nicht gültig aus.')
  const confirm = formString(formData, 'confirm', 10) === 'verify' ? 'verify' : 'direct'
  if (confirm === 'verify' && !emailInput) errors.push('Für eine Bestätigung per Mail braucht es eine E-Mail-Adresse.')
  const adminNote = parseAdminNote(formData)
  if (!base.ok || errors.length > 0) return { ok: false, errors }
  return { ok: true, input: { ...base.input, email, confirm, notify: formFlag(formData, 'notify'), adminNote } }
}

export function parseAdminNote(formData: FormData): string | null {
  const note = formString(formData, 'adminNote', ADMIN_NOTE_MAX).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim()
  return note || null
}

// --- Rundmail -----------------------------------------------------------------------------------

export type RecipientFilter = { scope: 'confirmed' | 'active'; tableKeys: string[] | null }

/** Empfänger: nur bestätigte oder auch unbestätigte Buchungen, optional nur bestimmte Tische. */
export function parseRecipientFilter(formData: FormData): RecipientFilter {
  const scope = formString(formData, 'scope', 20) === 'active' ? 'active' : 'confirmed'
  const onlyTables = formString(formData, 'tables', 10) === 'selected'
  const tableKeys = formData.getAll('tableKey').filter((v): v is string => typeof v === 'string' && /^t[1-9][0-9]{0,5}$/.test(v))
  return { scope, tableKeys: onlyTables ? [...new Set(tableKeys)] : null }
}

export function isRecipient(booking: StatusLike & { email: string | null; tableKeys: string[] }, filter: RecipientFilter, now: Date): boolean {
  if (!booking.email) return false
  const status = effectiveStatus(booking, now)
  if (status !== 'CONFIRMED' && !(filter.scope === 'active' && status === 'PENDING')) return false
  return filter.tableKeys === null || booking.tableKeys.some(key => filter.tableKeys!.includes(key))
}

/** Pause zwischen zwei Mails der Warteschlange (BROADCAST_MAILS_PER_MINUTE, Standard 30, 1-600). */
export function broadcastDelayMs(value: string | undefined): number {
  const perMinute = Number.parseInt(value ?? '', 10)
  const rate = Number.isInteger(perMinute) && perMinute >= 1 ? Math.min(perMinute, 600) : 30
  return Math.round(60_000 / rate)
}

// --- Anzeige ------------------------------------------------------------------------------------

export const MAIL_TYPE_LABELS: Record<string, string> = {
  verify: 'Bestätigungsanfrage',
  confirmed: 'Buchungsbestätigung',
  changed: 'Änderung (Kund*in)',
  'admin-changed': 'Änderung (Veranstalter*in)',
  cancelled: 'Stornierung',
  'already-booked': 'Hinweis „bereits gebucht“',
  'manage-link': 'Neuer Verwaltungslink',
  broadcast: 'Rundmail',
  'broadcast-test': 'Rundmail (Test)'
}

export const MAIL_STATUS_LABELS: Record<string, string> = {
  sent: 'verschickt', failed: 'gescheitert', queued: 'in Warteschlange', sending: 'wird verschickt', skipped: 'übersprungen'
}

/** Tische in natürlicher Reihenfolge (Tisch 2 vor Tisch 10). */
export function byLabel(a: { label: string }, b: { label: string }): number {
  return a.label.localeCompare(b.label, 'de', { numeric: true })
}
