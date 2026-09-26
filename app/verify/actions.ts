// app/verify/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { formString } from '../lib/form'
import { clientIp, codeRules, reserve } from '../lib/throttle'
import { bookingSecretsConfigured, manageToken } from '../lib/booking-tokens'
import { confirmByToken } from '../lib/events/booking'
import { offerAfterResponse } from '../lib/events/waitlist'

export type VerifyState = { message: string } | null

/**
 * Bestätigung über den Link aus der Mail - bewusst per POST (Button auf der Seite): Mail-Scanner
 * (Outlook Safe Links, Uni-Filter) rufen Links vorab per GET auf und dürfen dabei nichts bestätigen.
 * Berechtigt ist, wer den Token aus der Mail hat; gedrosselt wie die Code-Eingabe.
 */
export async function confirmLinkAction(_previous: VerifyState, formData: FormData): Promise<VerifyState> {
  const bookingId = formString(formData, 'bookingId', 50)
  const token = formString(formData, 'token', 100)
  if (!(await reserve(codeRules(await clientIp())))) return { message: 'Zu viele Versuche in kurzer Zeit. Bitte warte etwas.' }
  if (!bookingSecretsConfigured()) return { message: 'Die Online-Buchung ist gerade nicht möglich.' }

  const result = await confirmByToken(bookingId, token)
  switch (result.kind) {
    case 'confirmed':
      redirect(`/b/${result.bookingId}/${manageToken(result.bookingId, result.manageTokenVersion)}?confirmed=1`)
    case 'waitlisted': {
      const eventId = result.eventId
      offerAfterResponse(eventId)
      redirect(`/b/${result.bookingId}/${manageToken(result.bookingId, result.manageTokenVersion)}?waitlisted=1`)
    }
    case 'already':
      return { message: 'Das ist bereits bestätigt. Den Link zu deiner Buchung bzw. deinem Eintrag findest du in der Bestätigungsmail.' }
    case 'expired':
      return { message: 'Die Reservierung ist abgelaufen, der Tisch ist wieder frei. Bitte buche neu.' }
    default:
      return { message: 'Dieser Link ist ungültig oder wurde durch eine neuere Mail ersetzt.' }
  }
}
