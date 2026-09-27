// app/rsvp/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '../lib/prisma'
import { formString } from '../lib/form'
import { clientIp, reserve, rsvpBookRules } from '../lib/throttle'
import { bookingSecretsConfigured, manageToken } from '../lib/booking-tokens'
import { bookingWindow } from '../lib/events/booking-rules'
import { formSeatKeys } from '../lib/events/seat-rules'
import { afterBookingChange } from '../lib/events/waitlist'
import { bookViaRsvp, readSeatLink } from '../lib/rsvp/booking'
import { externalRefOf } from '../lib/rsvp/rules'

/**
 * Buchen über eine Zusage aus rsvp-app (docs/KONZEPT.md Abschnitt 9 A). Berechtigt ist, wer einen gültigen,
 * signierten Link für GENAU dieses Event hat (app/lib/rsvp/token.ts) - die Aktion prüft ihn selbst erneut,
 * dazu Buchungszeitraum und Drosselung. Die Seite davor (GET) ändert nichts.
 */

export type RsvpBookState = { errors: string[] } | null

const EXPIRED = 'Dieser Link ist abgelaufen oder ungültig. Öffne die Platzwahl bitte erneut über „Sitzplatz wählen“ in rsvp-app – deine Auswahl ist dann noch einmal zu treffen.'

export async function bookViaRsvpAction(_previous: RsvpBookState, formData: FormData): Promise<RsvpBookState> {
  const eventId = formString(formData, 'eventId', 50)
  const event = /^[a-z0-9]{10,40}$/.test(eventId) ? await prisma.event.findUnique({ where: { id: eventId } }) : null
  const link = event ? readSeatLink(formString(formData, 'token', 20_000), event) : null
  if (!event || !link) return { errors: [EXPIRED] }
  const window = bookingWindow(event, new Date(), 'RSVP')
  if (!window.open) return { errors: [window.message] }
  if (!bookingSecretsConfigured()) return { errors: ['Die Platzwahl ist gerade nicht möglich. Bitte versuch es später noch einmal.'] }

  const ip = await clientIp()
  if (!(await reserve(rsvpBookRules(ip, externalRefOf(link.rsvpEventId, link.rsvpId))))) {
    return { errors: ['Zu viele Versuche in kurzer Zeit. Bitte warte etwas und versuche es dann erneut.'] }
  }

  const unitKeys = event.mode === 'SEAT' ? formSeatKeys(formData) : [formString(formData, 'unitKey', 40)]
  const result = await bookViaRsvp(event, link, unitKeys)
  switch (result.kind) {
    case 'taken':
      return { errors: [event.mode === 'SEAT' ? 'Mindestens einer der Plätze wurde gerade vergeben. Bitte wähle neu – lade dazu die Seite neu.' : 'Dieser Tisch wurde gerade vergeben. Bitte wähle einen anderen – lade dazu die Seite neu.'] }
    case 'unfit':
      return { errors: [result.message] }
    case 'booked':
    case 'existing': {
      afterBookingChange(event.id)
      revalidatePath(`/${event.slug}`)
      const { booking } = result
      redirect(`/b/${booking.id}/${manageToken(booking.id, booking.manageTokenVersion)}${result.kind === 'booked' ? '?confirmed=1' : ''}`)
    }
  }
}
