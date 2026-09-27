// app/admin/events/arrange-actions.ts
'use server'

import { redirect } from 'next/navigation'
import { refresh, revalidatePath } from 'next/cache'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { loadEventForUser, type LoadedEvent } from '../../lib/events/store'
import { adminMoveBooking, loadAdminBooking } from '../../lib/events/admin-booking'
import { createParty, importParties, placeAttendee, placeParty, updateParty } from '../../lib/events/assign'
import { parseGuestCsv, parsePartyEdit, parsePartyForm, type ImportParty } from '../../lib/events/assign-rules'
import { parseAdminNote, parseUpdatedAt } from '../../lib/events/admin-rules'
import { SEAT_KEY } from '../../lib/events/seat-rules'
import { afterBookingChange } from '../../lib/events/waitlist'
import type { BookingFormState } from './booking-actions'

/**
 * Sitzordnung und Verschieben im Plan (docs/KONZEPT.md Abschnitt 8, Phase 6). Die Plan-Aktionen ruft
 * die Client-Komponente app/ui/plan/arrange-board.tsx direkt auf, nicht über ein Formular - also prüft
 * JEDE hier alle Argumente selbst (Typ und Form), dazu Konto, Zugriff auf das Event (loadEventForUser)
 * und den Modus. Personen, Gruppen und Buchungen werden nur zusammen mit der eventId gesucht; eine id
 * aus einem fremden Event gibt es damit nicht.
 */

export type ArrangeResult = { ok: true; message: string } | { ok: false; error: string }

const ID = /^[a-z0-9]{10,40}$/
const TABLE_KEY = /^t[1-9][0-9]{0,5}$/
const FORBIDDEN: ArrangeResult = { ok: false, error: 'Kein Zugriff auf dieses Event.' }

/** Angemeldetes Konto und das Event - null, wenn es das Event nicht gibt oder das Konto keinen Zugriff hat. */
async function eventFor(eventId: unknown): Promise<{ user: { id: string }; event: LoadedEvent } | null> {
  const user = await requireUser('/admin/events')
  if (typeof eventId !== 'string' || !ID.test(eventId)) return null
  const event = await loadEventForUser(eventId, user)
  return event ? { user, event } : null
}

function isSeatKey(value: unknown): value is string {
  return typeof value === 'string' && SEAT_KEY.test(value)
}

/** Nach einer Änderung: Ansicht (Plan und Liste) des aufrufenden Clients neu laden. */
function answer(result: ArrangeResult): ArrangeResult {
  refresh()
  return result
}

// --- Modus ASSIGNED -----------------------------------------------------------------------------

/** Person setzen, umsetzen, tauschen (to besetzt) oder vom Platz nehmen (to null). from: wo der Client sie sah. */
export async function placeAttendeeOnPlan(eventId: string, attendeeId: string, from: string | null, to: string | null): Promise<ArrangeResult> {
  const context = await eventFor(eventId)
  if (!context) return FORBIDDEN
  const { user, event } = context
  if (event.mode !== 'ASSIGNED') return { ok: false, error: 'Personen setzt du nur bei einer Sitzordnung.' }
  if (typeof attendeeId !== 'string' || !ID.test(attendeeId)) return { ok: false, error: 'Unbekannte Person.' }
  if ((from !== null && !isSeatKey(from)) || (to !== null && !isSeatKey(to))) return { ok: false, error: 'Unbekannter Platz.' }
  const result = await placeAttendee(event, attendeeId, from, to, user.id)
  // Platzierung an rsvp-app melden (bei einer verknüpften Gästeliste).
  if (result.ok) afterBookingChange(event.id)
  return answer(result)
}

/** Alle Personen einer Gruppe ohne Platz zusammen ab dem Zielplatz setzen. */
export async function placePartyOnPlan(eventId: string, bookingId: string, to: string): Promise<ArrangeResult> {
  const context = await eventFor(eventId)
  if (!context) return FORBIDDEN
  const { user, event } = context
  if (event.mode !== 'ASSIGNED') return { ok: false, error: 'Gruppen setzt du nur bei einer Sitzordnung.' }
  if (typeof bookingId !== 'string' || !ID.test(bookingId)) return { ok: false, error: 'Unbekannte Gruppe.' }
  if (!isSeatKey(to)) return { ok: false, error: 'Unbekannter Platz.' }
  const result = await placeParty(event, bookingId, to, user.id)
  if (result.ok) afterBookingChange(event.id)
  return answer(result)
}

/** Formular "Gruppe anlegen" auf der Seite Sitzordnung. */
export async function createPartyAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const context = await eventFor(formString(formData, 'eventId', 50))
  if (!context) redirect('/admin/events')
  const { user, event } = context
  if (event.mode !== 'ASSIGNED') return { errors: ['Gruppen legst du nur bei einer Sitzordnung an.'] }
  const parsed = parsePartyForm(formData)
  if (!parsed.ok) return { errors: parsed.errors }
  await createParty(event, { ...parsed.input, note: parseAdminNote(formData) }, user.id)
  refresh()
  return { errors: [], message: `„${parsed.input.name}“ mit ${parsed.input.persons.length} ${parsed.input.persons.length === 1 ? 'Person' : 'Personen'} angelegt.` }
}

export type ImportState = { errors: string[]; message?: string; preview?: { csv: string; parties: ImportParty[]; persons: number } } | null

const CSV_MAX = 500_000

/**
 * Gästeliste per CSV, in zwei Schritten: Erst prüfen und Vorschau zeigen (nichts wird gespeichert),
 * dann mit "confirm" dieselbe Datei übernehmen. Der Text reist dafür im Formular mit und wird beim
 * Übernehmen erneut geprüft - der Client kann an der Vorschau nichts vorbeischmuggeln.
 */
export async function importGuestsAction(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const context = await eventFor(formString(formData, 'eventId', 50))
  if (!context) redirect('/admin/events')
  const { user, event } = context
  if (event.mode !== 'ASSIGNED') return { errors: ['Gäste importierst du nur bei einer Sitzordnung.'] }

  let csv = formString(formData, 'csv', CSV_MAX + 1)
  const file = formData.get('file')
  if (file instanceof File && file.size > 0) {
    if (file.size > CSV_MAX) return { errors: ['Die Datei ist zu groß (höchstens 500 KB).'] }
    csv = await file.text()
  }
  if (csv.length > CSV_MAX) return { errors: ['Die Datei ist zu groß (höchstens 500 KB).'] }
  if (!csv.trim()) return { errors: ['Bitte wähle eine CSV-Datei oder füge die Liste ein.'] }

  const parsed = parseGuestCsv(csv)
  if (!parsed.ok) return { errors: parsed.errors }
  if (formData.get('confirm') !== '1') return { errors: [], preview: { csv, parties: parsed.parties, persons: parsed.persons } }

  const persons = await importParties(event, parsed.parties, user.id)
  refresh()
  return { errors: [], message: `${parsed.parties.length} ${parsed.parties.length === 1 ? 'Gruppe' : 'Gruppen'} mit ${persons} ${persons === 1 ? 'Person' : 'Personen'} übernommen.` }
}

/** Formular "Gruppe bearbeiten" (Buchungsseite im Modus ASSIGNED): Name, Personen, interne Notiz. */
export async function updatePartyAction(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const context = await eventFor(formString(formData, 'eventId', 50))
  if (!context) redirect('/admin/events')
  const { user, event } = context
  if (event.mode !== 'ASSIGNED') return { errors: ['Gruppen bearbeitest du nur bei einer Sitzordnung.'] }
  const bookingId = formString(formData, 'bookingId', 50)
  if (!ID.test(bookingId)) return { errors: ['Diese Gruppe gibt es nicht (mehr).'] }
  const parsed = parsePartyEdit(formData)
  if (!parsed.ok) return { errors: parsed.errors }
  const expected = parseUpdatedAt(formString(formData, 'updatedAt', 40))
  if (!expected) return { errors: ['Die Seite ist veraltet. Bitte lade sie neu.'] }
  const result = await updateParty(event, bookingId, parsed.input, expected, user.id)
  if (!result.ok) return { errors: [result.error] }
  if (result.changed) afterBookingChange(event.id)
  redirect(`/admin/events/${event.id}/bookings/${bookingId}?done=${result.changed ? 'party' : 'unchanged'}`)
}

// --- Modus TABLE und SEAT -----------------------------------------------------------------------

/**
 * Buchung im Plan verschieben (nach Rückfrage im Client): TABLE von Tisch zu Tisch, SEAT einen Platz.
 * updatedAt: Stand, den der Client gesehen hat. notify: Änderungsmail an bestätigte Buchungen.
 */
export async function moveBookingOnPlan(
  eventId: string, bookingId: string, from: string, to: string, updatedAt: string, notify: boolean
): Promise<ArrangeResult> {
  const context = await eventFor(eventId)
  if (!context) return FORBIDDEN
  const { user, event } = context
  if (event.mode !== 'TABLE' && event.mode !== 'SEAT') return { ok: false, error: 'Buchungen verschiebst du nur bei Tisch- oder Platzbuchung.' }
  const key = event.mode === 'SEAT' ? SEAT_KEY : TABLE_KEY
  if (typeof from !== 'string' || typeof to !== 'string' || !key.test(from) || !key.test(to)) return { ok: false, error: 'Unbekannter Tisch oder Platz.' }
  if (typeof bookingId !== 'string' || !ID.test(bookingId)) return { ok: false, error: 'Diese Buchung gibt es nicht (mehr).' }
  const expected = typeof updatedAt === 'string' ? parseUpdatedAt(updatedAt) : null
  if (!expected) return { ok: false, error: 'Die Ansicht ist veraltet. Bitte lade die Seite neu.' }
  const booking = await loadAdminBooking(event.id, bookingId)
  if (!booking) return { ok: false, error: 'Diese Buchung gibt es nicht (mehr).' }

  const result = await adminMoveBooking(event, booking, from, to, expected, notify === true, user.id)
  if (!result.ok) return answer({ ok: false, error: result.errors.join(' ') })
  // Ein Tisch ist frei geworden: der Warteliste anbieten; öffentliche Seite neu.
  afterBookingChange(event.id)
  revalidatePath(`/${event.slug}`)
  if (!result.changed) return answer({ ok: true, message: 'Nichts geändert.' })
  return answer({ ok: true, message: `„${booking.name}“ verschoben.${result.mailFailed ? ' Die Mail an die Kund*in konnte aber nicht verschickt werden.' : ''}` })
}
