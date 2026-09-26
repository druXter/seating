// app/b/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { formString } from '../lib/form'
import { bookingSecretsConfigured } from '../lib/booking-tokens'
import { parseContact, parsePartySize } from '../lib/events/booking-rules'
import { formSeatKeys } from '../lib/events/seat-rules'
import { cancelBooking, changeBooking, loadManagedBooking } from '../lib/events/booking'
import { acceptOffer, declineOffer, leaveWaitlist, offerAfterResponse } from '../lib/events/waitlist'

/**
 * Aktionen über den persönlichen Verwaltungslink (docs/KONZEPT.md Abschnitt 4, Schritt 7). Berechtigt
 * ist, wer den Link hat: JEDE Aktion prüft den Token für genau diese Buchung (loadManagedBooking,
 * Vergleich mit konstanter Laufzeit) und die Änderungsfrist selbst - nie nur die Seite.
 */

export type ManageState = { errors: string[] } | null

async function managed(formData: FormData) {
  if (!bookingSecretsConfigured()) return null
  const bookingId = formString(formData, 'bookingId', 50)
  const token = formString(formData, 'token', 100)
  const booking = await loadManagedBooking(bookingId, token)
  return booking ? { booking, path: `/b/${bookingId}/${token}` } : null
}

export async function changeBookingAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const context = await managed(formData)
  if (!context) return { errors: ['Dieser Link ist ungültig.'] }
  const { booking, path } = context

  const errors: string[] = []
  const contact = parseContact(formData, booking.event.requirePhone, errors)
  // Modus SEAT: die gewählten Plätze (Personenzahl = Zahl der Plätze); TABLE: Tisch und Personenzahl.
  const seatMode = booking.event.mode === 'SEAT'
  const unitKeys = seatMode ? formSeatKeys(formData) : [formString(formData, 'unitKey', 40)]
  const partySize = seatMode ? unitKeys.length : parsePartySize(formString(formData, 'partySize', 5))
  if (seatMode && unitKeys.length === 0) errors.push('Bitte wähle mindestens einen Platz.')
  if (!seatMode && partySize === null) errors.push('Bitte gib an, wie viele Personen ihr seid.')
  if (errors.length > 0 || partySize === null) return { errors }

  const result = await changeBooking(booking, { ...contact, partySize, unitKeys })
  if (!result.ok) return { errors: result.errors }
  // Ein Tisch oder Plätze können frei geworden sein.
  offerAfterResponse(booking.eventId)
  revalidatePath(`/${booking.event.slug}`)
  redirect(`${path}?${result.changed ? 'changed' : 'unchanged'}=1`)
}

export async function cancelBookingAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const context = await managed(formData)
  if (!context) return { errors: ['Dieser Link ist ungültig.'] }
  const result = await cancelBooking(context.booking)
  if (!result.ok) return { errors: result.errors }
  offerAfterResponse(context.booking.eventId)
  revalidatePath(`/${context.booking.event.slug}`)
  redirect(`${context.path}?cancelled=1`)
}

// --- Warteliste (docs/KONZEPT.md Abschnitt 5) ----------------------------------------------------

export async function acceptOfferAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const context = await managed(formData)
  if (!context) return { errors: ['Dieser Link ist ungültig.'] }
  const result = await acceptOffer(context.booking)
  if (!result.ok) return { errors: result.errors }
  revalidatePath(`/${context.booking.event.slug}`)
  redirect(`${context.path}?accepted=1`)
}

export async function declineOfferAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const context = await managed(formData)
  if (!context) return { errors: ['Dieser Link ist ungültig.'] }
  const result = await declineOffer(context.booking)
  if (!result.ok) return { errors: result.errors }
  offerAfterResponse(context.booking.eventId)
  revalidatePath(`/${context.booking.event.slug}`)
  redirect(`${context.path}?declined=1`)
}

export async function leaveWaitlistAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const context = await managed(formData)
  if (!context) return { errors: ['Dieser Link ist ungültig.'] }
  const result = await leaveWaitlist(context.booking)
  if (!result.ok) return { errors: result.errors }
  redirect(`${context.path}?left=1`)
}
