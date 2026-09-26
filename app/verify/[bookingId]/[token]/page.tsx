// app/verify/[bookingId]/[token]/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDateTime, formatRange } from '../../../lib/timezone'
import { bookingForVerifyLink, tableOf } from '../../../lib/events/booking'
import Notice from '../../../ui/notice'
import ConfirmButton from './confirm-button'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Buchung bestätigen', robots: { index: false, follow: false } }

/**
 * Zielseite des Links aus der Verifizierungsmail. GET zeigt nur an - bestätigt wird erst mit dem
 * Button (POST, siehe ../../actions.ts). Header: Regel "/verify/:path*" in next.config.ts
 * (kein Einbetten, kein Caching, kein Referer - der Token steht in der URL).
 */
export default async function VerifyPage({ params }: { params: Promise<{ bookingId: string; token: string }> }) {
  const { bookingId, token } = await params
  const booking = await bookingForVerifyLink(bookingId, token)
  const now = new Date()
  const table = booking ? await tableOf(booking.id) : null
  // Reservierung oder (noch unbestätigter) Eintrag auf der Warteliste, jeweils innerhalb der Frist.
  const waitlist = booking?.status === 'WAITLISTED'
  const valid = booking && (booking.status === 'PENDING' || (waitlist && !booking.emailVerifiedAt)) && booking.expiresAt && booking.expiresAt > now

  return (
    <main className="bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-4 text-gray-900">
        <h1 className="text-2xl font-bold">{waitlist ? 'Eintrag auf der Warteliste bestätigen' : 'Buchung bestätigen'}</h1>
        {!booking ? (
          <Notice tone="error">
            Dieser Link ist ungültig, wurde schon verwendet oder durch eine neuere Mail ersetzt. Hast du bereits bestätigt,
            findest du den Link zu deiner Buchung in der Bestätigungsmail.
          </Notice>
        ) : !valid ? (
          <>
            <Notice tone="error">{waitlist ? 'Die Frist für die Bestätigung ist abgelaufen.' : 'Die Reservierung ist abgelaufen, der Tisch ist wieder frei.'}</Notice>
            <p className="text-sm"><Link href={`/${booking.event.slug}`} className="text-blue-700 underline">{waitlist ? 'Neu eintragen' : 'Neu buchen'}</Link></p>
          </>
        ) : (
          <>
            <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-gray-600">Veranstaltung</dt><dd>{booking.event.title}</dd>
              <dt className="text-gray-600">Wann</dt><dd>{formatRange(booking.event.startsAt, booking.event.endsAt, booking.event.timezone)}</dd>
              {!waitlist && <><dt className="text-gray-600">Tisch</dt><dd>{table?.label}</dd></>}
              <dt className="text-gray-600">Personen</dt><dd>{booking.partySize}</dd>
              <dt className="text-gray-600">Name</dt><dd>{booking.name}</dd>
            </dl>
            <p className="text-sm text-gray-700">
              {waitlist
                ? `Bitte bis ${formatDateTime(booking.expiresAt!, booking.event.timezone)} bestätigen. Mit dem Klick bestätigst du deine E-Mail-Adresse und stehst auf der Warteliste.`
                : `Reserviert bis ${formatDateTime(booking.expiresAt!, booking.event.timezone)}. Mit dem Klick bestätigst du deine E-Mail-Adresse, und die Buchung gilt.`}
            </p>
            <ConfirmButton bookingId={booking.id} token={token} label={waitlist ? 'Eintrag bestätigen' : 'Buchung bestätigen'} />
          </>
        )}
      </div>
    </main>
  )
}
