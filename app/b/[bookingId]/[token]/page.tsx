// app/b/[bookingId]/[token]/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDateTime, formatRange } from '../../../lib/timezone'
import { bookingSecretsConfigured } from '../../../lib/booking-tokens'
import { canSelfEdit, selfEditDeadline } from '../../../lib/events/booking-rules'
import { loadManagedBooking } from '../../../lib/events/booking'
import { loadUnitStates } from '../../../lib/events/store'
import { seatPickerData } from '../../../lib/events/places'
import { parseLayout } from '../../../lib/floorplan/schema'
import Notice from '../../../ui/notice'
import { acceptOfferAction, declineOfferAction, leaveWaitlistAction } from '../../actions'
import { CancelForm, ChangeForm, ManageButtonForm } from './manage-forms'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Deine Buchung', robots: { index: false, follow: false } }

type Search = {
  confirmed?: string; changed?: string; unchanged?: string; cancelled?: string; waitlisted?: string; accepted?: string; declined?: string; left?: string
}

/**
 * Persönliche Verwaltungsseite einer Buchung (/b/<id>/<token>, docs/KONZEPT.md Abschnitt 6).
 * Falscher Token -> 404, ohne zu verraten, ob es die Buchung gibt. Header: Regel "/b/:path*" in
 * next.config.ts (no-store, no-referrer, noindex, kein Einbetten).
 */
export default async function ManagePage({ params, searchParams }: {
  params: Promise<{ bookingId: string; token: string }>
  searchParams: Promise<Search>
}) {
  const { bookingId, token } = await params
  if (!bookingSecretsConfigured()) notFound()
  const booking = await loadManagedBooking(bookingId, token)
  if (!booking) notFound()
  const search = await searchParams
  const { event } = booking
  const now = new Date()
  const editable = booking.status === 'CONFIRMED' && canSelfEdit(event, now)
  // Warteliste (Konzept Abschnitt 5): Eintrag, offenes Angebot, beendeter Eintrag.
  const waiting = booking.status === 'WAITLISTED'
  const offerOpen = booking.status === 'OFFERED' && booking.expiresAt !== null && booking.expiresAt > now
  const fromWaitlist = booking.waitlistedAt !== null
  const showTable = booking.status === 'CONFIRMED' || booking.status === 'OFFERED'

  let tables: { key: string; label: string; capacity: number }[] = []
  const layout = parseLayout(event.layout)
  const seatData = editable && event.mode === 'SEAT' && layout.ok ? await seatPickerData(event, now, { ownBookingId: booking.id }) : null
  if (editable && !seatData) {
    const { units, states } = await loadUnitStates(event.id, now)
    tables = units
      .filter(unit => unit.kind === 'TABLE' && unit.bookable && (unit.key === booking.table?.key || states.get(unit.key) === 'free'))
      .map(unit => ({ key: unit.key, label: unit.label, capacity: unit.capacity }))
      .sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))
  }

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
        <h1 className="text-2xl font-bold">{waiting || (fromWaitlist && booking.status !== 'CONFIRMED') ? 'Dein Eintrag auf der Warteliste' : 'Deine Buchung'}</h1>
        {search.waitlisted === '1' && <Notice tone="success">Du stehst jetzt auf der Warteliste. Wird ein passender Tisch frei, bekommst du ein Angebot per Mail.</Notice>}
        {search.accepted === '1' && <Notice tone="success">Angebot angenommen – deine Buchung ist bestätigt. Die Bestätigungsmail mit Kalendereintrag ist unterwegs.</Notice>}
        {search.declined === '1' && <Notice tone="success">Du hast das Angebot abgelehnt, dein Eintrag ist beendet. Der Tisch geht an die nächste Gruppe.</Notice>}
        {search.left === '1' && <Notice tone="success">Du bist von der Warteliste ausgetragen.</Notice>}
        {search.confirmed === '1' && <Notice tone="success">Deine Buchung ist bestätigt. Die Bestätigungsmail mit Kalendereintrag ist unterwegs.</Notice>}
        {search.changed === '1' && <Notice tone="success">Änderungen gespeichert. Du bekommst eine Mail mit dem aktualisierten Kalendereintrag.</Notice>}
        {search.unchanged === '1' && <Notice tone="info">Es gab nichts zu ändern.</Notice>}
        {search.cancelled === '1' && <Notice tone="success">Deine Buchung ist storniert. Du bekommst eine Bestätigung per Mail.</Notice>}
        {booking.status === 'CANCELLED' && !search.cancelled && !search.declined && !search.left && (
          <Notice tone="warning">{fromWaitlist ? 'Dieser Eintrag ist beendet.' : 'Diese Buchung wurde storniert.'}</Notice>
        )}
        {booking.status === 'EXPIRED' && <Notice tone="warning">Das Angebot ist verfallen, dein Eintrag ist beendet. Du kannst dich auf der Seite der Veranstaltung erneut eintragen.</Notice>}
        {booking.status === 'OFFERED' && !offerOpen && <Notice tone="warning">Das Angebot ist abgelaufen, der Tisch geht an die nächste Gruppe.</Notice>}

        <div className="bg-white p-6 rounded-lg shadow space-y-3">
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-gray-600">Veranstaltung</dt><dd><Link href={`/${event.slug}`} className="text-blue-700 hover:underline">{event.title}</Link></dd>
            <dt className="text-gray-600">Wann</dt><dd>{formatRange(event.startsAt, event.endsAt, event.timezone)}</dd>
            {event.location && <><dt className="text-gray-600">Wo</dt><dd>{event.location}</dd></>}
            {showTable && <><dt className="text-gray-600">{event.mode === 'SEAT' ? 'Plätze' : 'Tisch'}</dt><dd>{booking.placeLabel}</dd></>}
            {waiting && booking.waitlistedAt && <><dt className="text-gray-600">Auf der Warteliste seit</dt><dd>{formatDateTime(booking.waitlistedAt, event.timezone)}</dd></>}
            <dt className="text-gray-600">Personen</dt><dd>{booking.partySize}</dd>
            <dt className="text-gray-600">Name</dt><dd>{booking.name}</dd>
            <dt className="text-gray-600">E-Mail</dt><dd>{booking.email}</dd>
            {booking.phone && <><dt className="text-gray-600">Telefon</dt><dd>{booking.phone}</dd></>}
            {booking.note && <><dt className="text-gray-600">Anmerkung</dt><dd className="whitespace-pre-line">{booking.note}</dd></>}
          </dl>
        </div>

        {waiting && (
          <div className="bg-white p-6 rounded-lg shadow space-y-3">
            <p className="text-sm text-gray-700">
              Wird ein passender Tisch frei, bekommst du ein Angebot per Mail. Es gilt {event.offerTtlHours} {event.offerTtlHours === 1 ? 'Stunde' : 'Stunden'}
              {' '}(höchstens bis Buchungsschluss). Die Reihenfolge richtet sich nach dem Zeitpunkt der Anmeldung – Gruppen, für die ein frei
              gewordener Tisch passt, kommen zuerst dran.
            </p>
            <ManageButtonForm action={leaveWaitlistAction} bookingId={booking.id} token={token} label="Von der Warteliste austragen" confirmMessage="Wirklich von der Warteliste austragen?" />
          </div>
        )}

        {offerOpen && (
          <div className="bg-white p-6 rounded-lg shadow space-y-3 border-2 border-green-300">
            <h2 className="font-bold">{event.mode === 'SEAT' ? 'Plätze sind für euch frei' : 'Ein Tisch ist für euch frei'}</h2>
            <p className="text-sm text-gray-700">
              {booking.placeLabel}: für euch reserviert bis <strong>{formatDateTime(booking.expiresAt!, event.timezone)}</strong>.
              Nimmst du das Angebot bis dahin nicht an, geht es an die nächste Gruppe.
            </p>
            <ManageButtonForm action={acceptOfferAction} bookingId={booking.id} token={token} label="Angebot annehmen" primary />
            <ManageButtonForm action={declineOfferAction} bookingId={booking.id} token={token} label="Angebot ablehnen" confirmMessage="Angebot wirklich ablehnen? Dein Eintrag auf der Warteliste endet damit." />
          </div>
        )}

        {editable ? (
          <>
            <div className="bg-white p-6 rounded-lg shadow space-y-3">
              <h2 className="font-bold">Buchung ändern</h2>
              <p className="text-sm text-gray-600">Möglich bis {formatDateTime(selfEditDeadline(event), event.timezone)}.</p>
              <ChangeForm values={{
                bookingId: booking.id, token, name: booking.name, phone: booking.phone ?? '', note: booking.note ?? '',
                partySize: booking.partySize, unitKey: booking.table?.key ?? '', requirePhone: event.requirePhone, tables,
                seats: seatData && layout.ok ? {
                  layout: layout.layout, backgroundUrl: event.backgroundFile ? `/${event.slug}/background?v=${event.backgroundFile.slice(0, 8)}` : null,
                  seats: seatData.seats, groups: seatData.groups, initial: booking.places.map(p => p.key), max: event.maxSeatsPerBooking
                } : undefined
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
