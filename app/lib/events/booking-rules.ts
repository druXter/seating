// app/lib/events/booking-rules.ts
import type { BookingAccess, EventMode, EventStatus } from '@prisma/client'
import { formString, normalizeEmail } from '../form'
import { formatDateTime } from '../timezone'

/** Reine Regeln für die öffentliche Buchung (docs/KONZEPT.md Abschnitt 4) - ohne Datenbank testbar. */

export const BOOKING_LIMITS = { name: 100, phone: 30, note: 500 } as const
export const PENDING_TTL_RANGE = { min: 5, max: 24 * 60 } as const
export const SELF_EDIT_HOURS_MAX = 24 * 14
/** Höchstens so viele gleichzeitig unbestätigte Reservierungen pro IP (je Event). */
export const MAX_PENDING_PER_IP = 3

type EventWindow = {
  status: EventStatus
  mode: EventMode
  access: BookingAccess
  startsAt: Date
  endsAt: Date
  timezone: string
  bookingOpensAt: Date | null
  bookingClosesAt: Date | null
}

export type BookingWindow = { open: true } | { open: false; message: string }

/**
 * Ist das Buchen gerade möglich? Selbst buchen lässt sich nur ein veröffentlichtes Event im Modus
 * TABLE mit Zugang OPEN, innerhalb des Buchungszeitraums und vor Beginn.
 */
export function bookingWindow(event: EventWindow, now: Date): BookingWindow {
  if (event.endsAt <= now) return { open: false, message: 'Diese Veranstaltung hat bereits stattgefunden.' }
  if (event.status !== 'OPEN') return { open: false, message: 'Die Buchung ist geschlossen.' }
  if (event.mode !== 'TABLE' || event.access !== 'OPEN') return { open: false, message: 'Für diese Veranstaltung ist keine Online-Buchung vorgesehen.' }
  if (event.bookingOpensAt && event.bookingOpensAt > now) {
    return { open: false, message: `Buchen kannst du ab ${formatDateTime(event.bookingOpensAt, event.timezone)}.` }
  }
  const closes = event.bookingClosesAt && event.bookingClosesAt < event.startsAt ? event.bookingClosesAt : event.startsAt
  if (closes <= now) return { open: false, message: 'Die Buchung ist geschlossen.' }
  return { open: true }
}

/** Bis wann Buchende selbst ändern und stornieren dürfen (wandert mit, wenn das Event verschoben wird). */
export function selfEditDeadline(event: { startsAt: Date; selfEditHoursBefore: number }): Date {
  return new Date(event.startsAt.getTime() - event.selfEditHoursBefore * 60 * 60 * 1000)
}

export function canSelfEdit(event: { startsAt: Date; selfEditHoursBefore: number }, now: Date): boolean {
  return now < selfEditDeadline(event)
}

export type ContactFields = { name: string; phone: string | null; note: string | null }

function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Name, Telefon, Anmerkung - beim Buchen und beim Ändern über den Verwaltungslink. */
export function parseContact(formData: FormData, requirePhone: boolean, errors: string[]): ContactFields {
  const name = clean(formString(formData, 'name', BOOKING_LIMITS.name))
  if (!name) errors.push('Bitte gib deinen Namen an.')

  const phoneInput = clean(formString(formData, 'phone', BOOKING_LIMITS.phone))
  if (phoneInput && !/^\+?[0-9 ()/-]{5,30}$/.test(phoneInput)) errors.push('Die Telefonnummer sieht nicht gültig aus.')
  if (!phoneInput && requirePhone) errors.push('Bitte gib eine Telefonnummer an.')

  const noteInput = formString(formData, 'note', BOOKING_LIMITS.note).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim()
  return { name, phone: phoneInput || null, note: noteInput || null }
}

/** Gruppengröße: ganze Zahl ab 1. */
export function parsePartySize(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null
  const size = Number(value)
  return size >= 1 ? size : null
}

export type ReservationInput = ContactFields & { email: string; partySize: number; unitKey: string }
export type WaitlistInput = ContactFields & { email: string; partySize: number }

/**
 * Angaben zur Person - beim Buchen und beim Eintrag auf die Warteliste: Gruppengröße wird zur Kontrolle
 * zweimal abgefragt (Konzept Abschnitt 4, Schritt 3), der Datenschutzhinweis muss bestätigt sein.
 */
function parsePerson(formData: FormData, requirePhone: boolean, errors: string[]): (ContactFields & { email: string | null; partySize: number | null }) {
  const contact = parseContact(formData, requirePhone, errors)
  const email = normalizeEmail(formString(formData, 'email', 254))
  if (!email) errors.push('Bitte gib eine gültige E-Mail-Adresse an.')

  const partySize = parsePartySize(formString(formData, 'partySize', 5))
  const confirm = parsePartySize(formString(formData, 'partySizeConfirm', 5))
  if (partySize === null) errors.push('Bitte gib an, wie viele Personen ihr seid.')
  else if (confirm !== partySize) errors.push('Die beiden Angaben zur Personenzahl stimmen nicht überein.')
  return { ...contact, email, partySize }
}

function requirePrivacy(formData: FormData, errors: string[]) {
  if (formData.get('privacy') !== 'on') errors.push('Bitte bestätige, dass du den Datenschutzhinweis gelesen hast.')
}

/** Buchungsformular (Tisch gewählt). */
export function parseReservation(formData: FormData, requirePhone: boolean): { ok: true; input: ReservationInput } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const person = parsePerson(formData, requirePhone, errors)
  const unitKey = formString(formData, 'unitKey', 40)
  if (!/^t[1-9][0-9]{0,5}$/.test(unitKey)) errors.push('Bitte wähle einen Tisch.')
  requirePrivacy(formData, errors)

  if (errors.length > 0 || !person.email || person.partySize === null) return { ok: false, errors }
  return { ok: true, input: { ...person, email: person.email, partySize: person.partySize, unitKey } }
}

/** Eintrag auf die Warteliste (ohne Tisch). */
export function parseWaitlistEntry(formData: FormData, requirePhone: boolean): { ok: true; input: WaitlistInput } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const person = parsePerson(formData, requirePhone, errors)
  requirePrivacy(formData, errors)
  if (errors.length > 0 || !person.email || person.partySize === null) return { ok: false, errors }
  return { ok: true, input: { ...person, email: person.email, partySize: person.partySize } }
}
