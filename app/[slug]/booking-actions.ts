// app/[slug]/booking-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { formString } from '../lib/form'
import { clientIp, codeRules, reserve, reserveRules, resendRules } from '../lib/throttle'
import { bookingSecretsConfigured } from '../lib/booking-tokens'
import { bookingAvailable, manageUrl } from '../lib/booking-mail'
import { formatDeadline } from '../lib/timezone'
import { bookingWindow, parseReservation, parseWaitlistEntry } from '../lib/events/booking-rules'
import { confirmByCode, reserveTable, resendVerification } from '../lib/events/booking'
import { joinWaitlist, offerAfterResponse } from '../lib/events/waitlist'

/**
 * Öffentliche Buchung (Modus TABLE, Zugang OPEN). Kein Konto - jede Aktion prüft selbst, ob das Event
 * gerade buchbar ist, und reserviert ihren Versuch in der Drosselung, BEVOR sie etwas prüft oder
 * verschickt (docs/KONZEPT.md Abschnitt 4).
 */

export type ReserveState =
  | { step: 'form'; errors: string[] }
  | { step: 'pending'; bookingId: string; tableLabel: string; expiresAtText: string; email: string }
  | null

export type WaitlistState =
  | { step: 'form'; errors: string[] }
  | { step: 'pending'; bookingId: string; expiresAtText: string; email: string }
  | null

export type CodeState =
  | { kind: 'confirmed'; manageUrl: string }
  | { kind: 'waitlisted'; manageUrl: string }
  | { kind: 'error'; message: string }
  | null

export type ResendState = { sent: true } | { sent: false; message: string } | null

const BUSY = 'Zu viele Versuche in kurzer Zeit. Bitte warte etwas und versuche es dann erneut.'

async function bookableEvent(eventId: string) {
  const event = eventId ? await prisma.event.findUnique({ where: { id: eventId } }) : null
  if (!event) return { event: null, message: 'Diese Veranstaltung gibt es nicht.' }
  const window = bookingWindow(event, new Date())
  if (!window.open) return { event: null, message: window.message }
  if (!bookingAvailable()) return { event: null, message: 'Die Online-Buchung ist gerade nicht möglich.' }
  return { event, message: null }
}

export async function reserveAction(_previous: ReserveState, formData: FormData): Promise<ReserveState> {
  const { event, message } = await bookableEvent(formString(formData, 'eventId', 50))
  if (!event) return { step: 'form', errors: [message ?? 'Buchung nicht möglich.'] }

  const parsed = parseReservation(formData, event.requirePhone)
  if (!parsed.ok) return { step: 'form', errors: parsed.errors }

  const ip = await clientIp()
  if (!(await reserve(reserveRules(ip, parsed.input.email)))) return { step: 'form', errors: [BUSY] }

  const result = await reserveTable(event, parsed.input, ip)
  revalidatePath(`/${event.slug}`)
  switch (result.kind) {
    case 'reserved':
      return {
        step: 'pending', bookingId: result.bookingId, tableLabel: result.tableLabel, email: result.email,
        expiresAtText: formatDeadline(result.expiresAt, event.timezone)
      }
    case 'taken':
      return { step: 'form', errors: ['Dieser Tisch wurde gerade vergeben. Bitte wähle einen anderen – der Plan ist aktualisiert.'] }
    case 'unfit':
      return { step: 'form', errors: [result.message] }
    case 'limit':
      return { step: 'form', errors: ['Von deinem Anschluss aus gibt es schon mehrere unbestätigte Reservierungen. Bitte bestätige diese zuerst oder warte, bis sie ablaufen.'] }
    case 'mail-failed':
      return { step: 'form', errors: ['Die Bestätigungsmail konnte nicht verschickt werden. Es wurde nichts reserviert – bitte prüfe die Adresse oder versuche es später erneut.'] }
  }
}

/**
 * Auf die Warteliste (docs/KONZEPT.md Abschnitt 5). Gleiche Drosselung wie beim Reservieren; der
 * Server prüft selbst, dass wirklich kein passender Tisch frei ist.
 */
export async function joinWaitlistAction(_previous: WaitlistState, formData: FormData): Promise<WaitlistState> {
  const { event, message } = await bookableEvent(formString(formData, 'eventId', 50))
  if (!event) return { step: 'form', errors: [message ?? 'Eintragen nicht möglich.'] }

  const parsed = parseWaitlistEntry(formData, event.requirePhone)
  if (!parsed.ok) return { step: 'form', errors: parsed.errors }

  const ip = await clientIp()
  if (!(await reserve(reserveRules(ip, parsed.input.email)))) return { step: 'form', errors: [BUSY] }

  const result = await joinWaitlist(event, parsed.input)
  switch (result.kind) {
    case 'joined':
      return { step: 'pending', bookingId: result.bookingId, email: result.email, expiresAtText: formatDeadline(result.expiresAt, event.timezone) }
    case 'free':
      return { step: 'form', errors: ['Gerade ist ein passender Tisch frei – du kannst ihn direkt buchen. Lade die Seite neu, um ihn zu sehen.'] }
    case 'too-large':
      return { step: 'form', errors: [`Für ${parsed.input.partySize} Personen gibt es keinen passenden Tisch.`] }
    case 'off':
      return { step: 'form', errors: ['Für diese Veranstaltung gibt es keine Warteliste.'] }
    case 'mail-failed':
      return { step: 'form', errors: ['Die Bestätigungsmail konnte nicht verschickt werden. Bitte prüfe die Adresse oder versuche es später erneut.'] }
  }
}

export async function confirmCodeAction(_previous: CodeState, formData: FormData): Promise<CodeState> {
  const bookingId = formString(formData, 'bookingId', 50)
  const ip = await clientIp()
  if (!(await reserve(codeRules(ip)))) return { kind: 'error', message: BUSY }
  if (!bookingSecretsConfigured()) return { kind: 'error', message: 'Die Online-Buchung ist gerade nicht möglich.' }

  const result = await confirmByCode(bookingId, formString(formData, 'code', 20))
  switch (result.kind) {
    case 'confirmed':
      return { kind: 'confirmed', manageUrl: manageUrl({ id: result.bookingId, manageTokenVersion: result.manageTokenVersion }) }
    case 'waitlisted': {
      // Vielleicht ist inzwischen ein Tisch frei geworden - dann kommt gleich das Angebot.
      const eventId = result.eventId
      offerAfterResponse(eventId)
      return { kind: 'waitlisted', manageUrl: manageUrl({ id: result.bookingId, manageTokenVersion: result.manageTokenVersion }) }
    }
    case 'already':
      return { kind: 'error', message: 'Das ist bereits bestätigt. Den Link zu deiner Buchung bzw. deinem Eintrag findest du in der Bestätigungsmail.' }
    case 'expired':
      return { kind: 'error', message: 'Die Reservierung ist abgelaufen, der Tisch ist wieder frei. Bitte buche neu.' }
    case 'locked':
      return { kind: 'error', message: 'Zu viele falsche Codes. Fordere unten eine neue Mail an oder nutze den Link aus der Mail.' }
    default:
      return { kind: 'error', message: 'Der Code stimmt nicht. Bitte prüfe die Mail.' }
  }
}

export async function resendAction(_previous: ResendState, formData: FormData): Promise<ResendState> {
  const bookingId = formString(formData, 'bookingId', 50)
  const ip = await clientIp()
  if (!(await reserve(resendRules(ip, bookingId)))) return { sent: false, message: BUSY }
  if (!bookingAvailable()) return { sent: false, message: 'Die Online-Buchung ist gerade nicht möglich.' }
  await resendVerification(bookingId)
  // Immer dieselbe Antwort - unabhängig davon, ob es die Reservierung (noch) gibt.
  return { sent: true }
}

