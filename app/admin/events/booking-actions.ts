// app/admin/events/booking-actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { requireUser } from '../../lib/auth'
import { formString, normalizeEmail } from '../../lib/form'
import { loadEventForUser } from '../../lib/events/store'
import { sendBroadcastTestMail } from '../../lib/booking-mail'
import { BROADCAST_LIMITS } from '../../lib/mail-blocks'
import {
  adminAssignWaitlist, adminCancelBooking, adminChangeBooking, adminConfirmBooking, adminCorrectEmail, adminCreateBooking, adminDeleteBooking,
  adminRenewManageLink, adminResendVerification, adminSetNote, loadAdminBooking, type AdminResult
} from '../../lib/events/admin-booking'
import { formSeatKeys } from '../../lib/events/seat-rules'
import { formFlag, parseAdminChange, parseAdminCreate, parseAdminNote, parseRecipientFilter, parseUpdatedAt } from '../../lib/events/admin-rules'
import { queueBroadcast } from '../../lib/events/broadcast'
import { processMailQueue } from '../../lib/events/mail-queue'
import { offerAfterResponse } from '../../lib/events/waitlist'

/**
 * Buchungsverwaltung durch Veranstalter*innen (docs/KONZEPT.md Abschnitt 8). JEDE Aktion prüft selbst:
 * angemeldet, Zugriff auf das Event (loadEventForUser -> eventLevel, owner und moderator dürfen hier
 * alles) und eine Buchung GENAU dieses Events (loadAdminBooking) - nie nur die Seite. Eine Buchungs-id
 * aus einem fremden Event wird wie eine unbekannte behandelt.
 */

export type BookingFormState = { errors: string[]; message?: string } | null

const NOT_FOUND = 'Diese Buchung gibt es nicht (mehr).'

async function eventContext(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  return { user, event }
}

async function bookingContext(formData: FormData) {
  const { user, event } = await eventContext(formData)
  const booking = await loadAdminBooking(event.id, formString(formData, 'bookingId', 50))
  return { user, event, booking, path: booking ? `/admin/events/${event.id}/bookings/${booking.id}` : null }
}

/** Nach Erfolg zurück auf die Buchung, mit Rückmeldung (und Hinweis, falls die Mail scheiterte). */
async function finish(event: { id: string; slug: string }, path: string, result: AdminResult & { ok: true }, done: string): Promise<never> {
  // Ein Tisch kann frei geworden sein (Storno, Tischwechsel, Löschen): der Warteliste anbieten.
  offerAfterResponse(event.id)
  revalidatePath(`/${event.slug}`)
  redirect(`${path}?done=${result.changed ? done : 'unchanged'}${result.mailFailed ? '&mail=failed' : ''}`)
}

export async function changeBookingAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  const parsed = parseAdminChange(formData, event.mode)
  if (!parsed.ok) return { errors: parsed.errors }
  const expected = parseUpdatedAt(formString(formData, 'updatedAt', 40))
  if (!expected) return { errors: ['Die Seite ist veraltet. Bitte lade sie neu.'] }

  const result = await adminChangeBooking(event, booking, parsed.input, expected, formFlag(formData, 'notify'), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'changed')
}

export async function saveAdminNote(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  const result = await adminSetNote(booking, parseAdminNote(formData), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'note')
}

export async function cancelBookingAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  const result = await adminCancelBooking(event, booking, formFlag(formData, 'notify'), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'cancelled')
}

export async function deleteBookingAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking } = await bookingContext(formData)
  if (!booking) return { errors: [NOT_FOUND] }
  const result = await adminDeleteBooking(event, booking, formFlag(formData, 'notify'), user.id)
  if (!result.ok) return { errors: result.errors }
  // Ein Tisch kann frei geworden sein (Storno, Tischwechsel, Löschen): der Warteliste anbieten.
  offerAfterResponse(event.id)
  revalidatePath(`/${event.slug}`)
  redirect(`/admin/events/${event.id}/bookings?deleted=1${result.mailFailed ? '&mail=failed' : ''}`)
}

export async function confirmBookingAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  const result = await adminConfirmBooking(event, booking, formFlag(formData, 'notify'), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'confirmed')
}

export async function resendVerificationAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  const result = await adminResendVerification(event, booking, formFlag(formData, 'renew'), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'resent')
}

export async function correctEmailAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  const email = normalizeEmail(formString(formData, 'email', 254))
  if (!email) return { errors: ['Bitte gib eine gültige E-Mail-Adresse an.'] }
  const result = await adminCorrectEmail(event, booking, email, formFlag(formData, 'renew'), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'email')
}

export async function renewManageLinkAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  const result = await adminRenewManageLink(event, booking, formFlag(formData, 'notify'), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'link')
}

export async function assignWaitlistAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event, booking, path } = await bookingContext(formData)
  if (!booking || !path) return { errors: [NOT_FOUND] }
  // Modus SEAT: Plätze (mehrfach), TABLE: ein Tisch.
  const unitKeys = event.mode === 'SEAT' ? formSeatKeys(formData) : [formString(formData, 'unitKey', 40)]
  const result = await adminAssignWaitlist(event, booking, unitKeys, formFlag(formData, 'notify'), user.id)
  if (!result.ok) return { errors: result.errors }
  return finish(event, path, result, 'assigned')
}

export async function createBookingAdmin(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event } = await eventContext(formData)
  const parsed = parseAdminCreate(formData, event.mode)
  if (!parsed.ok) return { errors: parsed.errors }
  const result = await adminCreateBooking(event, parsed.input, user.id)
  if (!result.ok || !result.bookingId) return { errors: result.ok ? [NOT_FOUND] : result.errors }
  return finish(event, `/admin/events/${event.id}/bookings/${result.bookingId}`, result, 'created')
}

// --- Rundmail -----------------------------------------------------------------------------------

function parseBroadcast(formData: FormData) {
  const errors: string[] = []
  const subject = formString(formData, 'subject', BROADCAST_LIMITS.subject).replace(/[\u0000-\u001f\u007f]/g, ' ')
  const body = formString(formData, 'body', BROADCAST_LIMITS.body).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
  if (!subject) errors.push('Bitte gib einen Betreff an.')
  if (!body) errors.push('Bitte schreib einen Text.')
  return { errors, content: { subject, body, includeIcs: formFlag(formData, 'includeIcs') } }
}

/** Testversand an das eigene Konto, mit Beispieldaten (keine echte Buchung, kein echter Link). */
export async function sendBroadcastTest(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event } = await eventContext(formData)
  const { errors, content } = parseBroadcast(formData)
  if (errors.length > 0) return { errors }
  const sent = await sendBroadcastTestMail(event, user.email, content)
  return sent ? { errors: [], message: `Testmail an ${user.email} verschickt.` } : { errors: ['Die Testmail konnte nicht verschickt werden.'] }
}

export async function sendBroadcast(_previous: BookingFormState, formData: FormData): Promise<BookingFormState> {
  const { user, event } = await eventContext(formData)
  const { errors, content } = parseBroadcast(formData)
  const filter = parseRecipientFilter(formData)
  if (filter.tableKeys?.length === 0) errors.push('Bitte wähle mindestens einen Tisch.')
  if (formData.get('confirmSend') !== 'on') errors.push('Bitte bestätige, dass die Rundmail verschickt werden soll.')
  if (errors.length > 0) return { errors }

  const { count } = await queueBroadcast(event, content, filter, user.id)
  if (count === 0) return { errors: ['Zu dieser Auswahl gibt es keine Empfänger*innen.'] }
  // Verschickt wird nach der Antwort, gedrosselt - die Seite zeigt den Fortschritt.
  after(() => processMailQueue())
  redirect(`/admin/events/${event.id}/mail?queued=${count}`)
}
