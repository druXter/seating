// app/b/[bookingId]/[token]/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDateTime, formatRange } from '../../../lib/timezone'
import { bookingSecretsConfigured } from '../../../lib/booking-tokens'
import { canSelfEdit, selfEditDeadline } from '../../../lib/events/booking-rules'
import { loadManagedBooking } from '../../../lib/events/booking'
import { loadUnitStates } from '../../../lib/events/store'
import Notice from '../../../ui/notice'
import { CancelForm, ChangeForm } from './manage-forms'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Deine Buchung', robots: { index: false, follow: false } }

/**
 * Persönliche Verwaltungsseite einer Buchung (/b/<id>/<token>, docs/KONZEPT.md Abschnitt 6).
 * Falscher Token -> 404, ohne zu verraten, ob es die Buchung gibt. Header: Regel "/b/:path*" in
 * next.config.ts (no-store, no-referrer, noindex, kein Einbetten).
 */
export default async function ManagePage({ params, searchParams }: {
  params: Promise<{ bookingId: string; token: string }>
  searchParams: Promise<{ confirmed?: string; changed?: string; unchanged?: string; cancelled?: string }>
}) {
  const { bookingId, token } = await params
  if (!bookingSecretsConfigured()) notFound()
  const booking = await loadManagedBooking(bookingId, token)
  if (!booking) notFound()
  const search = await searchParams
  const { event } = booking
  const now = new Date()
  const editable = booking.status === 'CONFIRMED' && canSelfEdit(event, now)

  let tables: { key: string; label: string; capacity: number }[] = []
  if (editable) {
    const { units, states } = await loadUnitStates(event.id, now)
    tables = units
      .filter(unit => unit.kind === 'TABLE' && unit.bookable && (unit.key === booking.table?.key || states.get(unit.key) === 'free'))
      .map(unit => ({ key: unit.key, label: unit.label, capacity: unit.capacity }))
      .sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))
  }

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
        <h1 className="text-2xl font-bold">Deine Buchung</h1>
        {search.confirmed === '1' && <Notice tone="success">Deine Buchung ist bestätigt. Die Bestätigungsmail mit Kalendereintrag ist unterwegs.</Notice>}
        {search.changed === '1' && <Notice tone="success">Änderungen gespeichert. Du bekommst eine Mail mit dem aktualisierten Kalendereintrag.</Notice>}
        {search.unchanged === '1' && <Notice tone="info">Es gab nichts zu ändern.</Notice>}
        {search.cancelled === '1' && <Notice tone="success">Deine Buchung ist storniert. Du bekommst eine Bestätigung per Mail.</Notice>}
        {booking.status === 'CANCELLED' && search.cancelled !== '1' && <Notice tone="warning">Diese Buchung wurde storniert.</Notice>}

        <div className="bg-white p-6 rounded-lg shadow space-y-3">
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-gray-600">Veranstaltung</dt><dd><Link href={`/${event.slug}`} className="text-blue-700 hover:underline">{event.title}</Link></dd>
            <dt className="text-gray-600">Wann</dt><dd>{formatRange(event.startsAt, event.endsAt, event.timezone)}</dd>
            {event.location && <><dt className="text-gray-600">Wo</dt><dd>{event.location}</dd></>}
            {booking.status === 'CONFIRMED' && <><dt className="text-gray-600">Tisch</dt><dd>{booking.table?.label ?? '–'}</dd></>}
            <dt className="text-gray-600">Personen</dt><dd>{booking.partySize}</dd>
            <dt className="text-gray-600">Name</dt><dd>{booking.name}</dd>
            <dt className="text-gray-600">E-Mail</dt><dd>{booking.email}</dd>
            {booking.phone && <><dt className="text-gray-600">Telefon</dt><dd>{booking.phone}</dd></>}
            {booking.note && <><dt className="text-gray-600">Anmerkung</dt><dd className="whitespace-pre-line">{booking.note}</dd></>}
          </dl>
        </div>

        {editable ? (
          <>
            <div className="bg-white p-6 rounded-lg shadow space-y-3">
              <h2 className="font-bold">Buchung ändern</h2>
              <p className="text-sm text-gray-600">Möglich bis {formatDateTime(selfEditDeadline(event), event.timezone)}.</p>
              <ChangeForm values={{
                bookingId: booking.id, token, name: booking.name, phone: booking.phone ?? '', note: booking.note ?? '',
                partySize: booking.partySize, unitKey: booking.table?.key ?? '', requirePhone: event.requirePhone, tables
              }} />
            </div>
            <div className="bg-white p-6 rounded-lg shadow space-y-2">
              <h2 className="font-bold">Stornieren</h2>
              <CancelForm bookingId={booking.id} token={token} />
            </div>
          </>
        ) : booking.status === 'CONFIRMED' && (
          <Notice tone="info">
            Änderungen und Stornierungen sind nur bis {formatDateTime(selfEditDeadline(event), event.timezone)} selbst möglich.
            Bitte wende dich an die Veranstalter*innen{event.replyTo ? ` (${event.replyTo})` : ''}.
          </Notice>
        )}
        <p className="text-xs text-gray-600">
          Dieser Link ist dein persönlicher Zugang zu deiner Buchung – bitte gib ihn nicht weiter.
        </p>
      </div>
    </main>
  )
}
