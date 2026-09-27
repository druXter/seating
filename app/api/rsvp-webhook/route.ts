import { NextResponse } from 'next/server'
import { rsvpSecret, seatingOrigin } from '../../lib/rsvp/config'
import { verifyMessage } from '../../lib/rsvp/token'
import { applyRsvpChange } from '../../lib/rsvp/booking'
import { afterBookingChange } from '../../lib/events/waitlist'

/**
 * Webhook von rsvp-app (docs/KONZEPT.md Abschnitt 9, A.5): "diese Zusage hat sich geändert" - Body ist
 * die signierte Nachricht selbst (text/plain, token.ts rsvp-change), wie beim Vertrag zwischen rsvp-app
 * und Abstimmungstool. Ungültige Signatur, falscher Empfänger, abgelaufen: 401. Gültig, aber für kein
 * so verknüpftes Event: 200 ohne Wirkung - ob es das Event gibt, erfährt der Absender nicht.
 *
 * Wirkung (app/lib/rsvp/booking.ts, applyRsvpChange): Platzwahl über Zusagen - Absage storniert die
 * Buchung, sonst werden Name, Adresse und Personenzahl übernommen; Sitzordnung - nur der Hinweis
 * "bitte abgleichen". Danach wie nach jeder Buchungsänderung: Warteliste, Mails, Platzierungen melden.
 */

const MAX_BODY = 20_000

export async function POST(request: Request) {
  const secret = rsvpSecret()
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 404 })
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY) return NextResponse.json({ error: 'too large' }, { status: 413 })
  const body = (await request.text()).slice(0, MAX_BODY + 1)
  if (body.length > MAX_BODY) return NextResponse.json({ error: 'too large' }, { status: 413 })

  const message = verifyMessage(body, 'rsvp-change', { secret, audience: seatingOrigin() })
  if (!message) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  const outcome = await applyRsvpChange(message)
  if (outcome === 'cancelled' || outcome === 'updated') afterBookingChange(message.seatingEventId)
  return NextResponse.json({ ok: true })
}
