// app/b/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { formString } from '../lib/form'
import { bookingSecretsConfigured } from '../lib/booking-tokens'
import { parseContact, parsePartySize } from '../lib/events/booking-rules'
import { cancelBooking, changeBooking, loadManagedBooking } from '../lib/events/booking'

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
  const partySize = parsePartySize(formString(formData, 'partySize', 5))
  if (partySize === null) errors.push('Bitte gib an, wie viele Personen ihr seid.')
  const unitKey = formString(formData, 'unitKey', 40)
  if (errors.length > 0 || partySize === null) return { errors }

  const result = await changeBooking(booking, { ...contact, partySize, unitKey })
  if (!result.ok) return { errors: result.errors }
  revalidatePath(`/${booking.event.slug}`)
  redirect(`${path}?${result.changed ? 'changed' : 'unchanged'}=1`)
}

export async function cancelBookingAction(_previous: ManageState, formData: FormData): Promise<ManageState> {
  const context = await managed(formData)
  if (!context) return { errors: ['Dieser Link ist ungültig.'] }
  const result = await cancelBooking(context.booking)
  if (!result.ok) return { errors: result.errors }
  revalidatePath(`/${context.booking.event.slug}`)
  redirect(`${context.path}?cancelled=1`)
}
