// app/admin/events/[id]/bookings/page.tsx
import Link from 'next/link'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404, loadUnitStates } from '../../../../lib/events/store'
import { countStates } from '../../../../lib/events/occupancy'
import { loadAuditContext } from '../../../../lib/events/admin-booking'
import { describePlaces } from '../../../../lib/events/places'
import {
  BOOKING_SOURCE_LABELS, LIST_FILTERS, LIST_FILTER_LABELS, effectiveStatus, matchesListFilter, matchesSearch, parseListFilter
} from '../../../../lib/events/admin-rules'
import { actorText, auditDetails, auditText } from '../../../../lib/events/audit-text'
import { formatDeadline, formatShort } from '../../../../lib/timezone'
import BookingStatusBadge from '../../../../ui/booking-status-badge'
import RsvpSyncPanel from '../../rsvp-sync-panel'
import { ButtonLink, buttonClass, Card, EmptyState, inputClass, labelClass, SettingsSection, Notice } from '../../../../ui/kit'

export const dynamic = 'force-dynamic'

type Search = { q?: string; status?: string; deleted?: string; mail?: string }

/**
 * Buchungsliste eines Events (docs/KONZEPT.md Abschnitt 8): Suche, Filter nach Status, Zähler, Wege
 * zu Export, Druckansicht und Rundmail. Suche und Filter laufen über die (höchstens einige hundert)
 * Buchungen im Speicher - so klappt die Suche auch mit Umlauten und ohne Groß-/Kleinschreibung.
 */
export default async function BookingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/bookings`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const now = new Date()
  const filter = parseListFilter(search.status)
  const query = (search.q ?? '').slice(0, 100)
  const tz = event.timezone

  const [{ units, states }, all, eventLog] = await Promise.all([
    loadUnitStates(event.id, now),
    prisma.booking.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, email: true, phone: true, partySize: true, note: true, adminNote: true, status: true, source: true,
        expiresAt: true, createdAt: true, waitlistedAt: true, emailVerifiedAt: true, allocations: { select: { unit: { select: { key: true, label: true, kind: true } } } },
        attendees: { select: { name: true }, orderBy: { position: 'asc' } }, rsvpPartySize: true
      }
    }),
    prisma.auditLog.findMany({ where: { eventId: event.id, bookingId: null }, orderBy: { createdAt: 'desc' }, take: 20 })
  ])
  const unitKind = event.mode === 'TABLE' ? 'TABLE' : 'SEAT'
  const assigned = event.mode === 'ASSIGNED'
  const counts = countStates(units, states, unitKind)
  const confirmed = all.filter(b => effectiveStatus(b, now) === 'CONFIRMED')
  const guests = confirmed.reduce((sum, b) => sum + b.partySize, 0)
  const waitlist = all.filter(b => effectiveStatus(b, now) === 'WAITLISTED' && b.waitlistedAt !== null)
  const bookings = all
    .filter(b => matchesListFilter(b, filter, now))
    .filter(b => matchesSearch({ ...b, tables: [...b.allocations.map(a => a.unit.label), ...b.attendees.map(a => a.name)] }, query))
  // Warteliste in ihrer Reihenfolge (Zeitpunkt der Bestätigung; unbestätigte zuletzt).
  if (filter === 'waitlist') bookings.sort((a, b) => (a.waitlistedAt?.getTime() ?? Infinity) - (b.waitlistedAt?.getTime() ?? Infinity))
  const auditContext = await loadAuditContext(event.id, eventLog.map(e => e.actor))

  const exportQuery = new URLSearchParams({ status: filter, ...(query ? { q: query } : {}) }).toString()
  const base = `/admin/events/${event.id}`

  return (
    <div className="space-y-4">
      {search.deleted === '1' && <Notice tone="success">Buchung endgültig gelöscht.</Notice>}
      {search.mail === 'failed' && <Notice tone="warning">Die Mail an die Kund*in konnte nicht verschickt werden.</Notice>}

      <Card className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="booking-counts">
          {unitKind === 'SEAT' ? 'Plätze' : 'Tische'}: {counts.free} frei · {counts.held} reserviert (unbestätigt) · {counts.confirmed} belegt
          {counts.unavailable > 0 && ` · ${counts.unavailable} nicht buchbar`} — {confirmed.length} {assigned ? (confirmed.length === 1 ? 'Gruppe' : 'Gruppen') : `bestätigte Buchung${confirmed.length === 1 ? '' : 'en'}`} mit {guests} Person{guests === 1 ? '' : 'en'}
          {waitlist.length > 0 && <> — <Link href={`${base}/bookings?status=waitlist`} className="text-blue-700 dark:text-blue-300 hover:underline">{waitlist.length} auf der Warteliste</Link></>}
          {!event.waitlistEnabled && !assigned && ' — Warteliste aus'}
        </p>
        <div className="flex flex-wrap gap-2">
          {assigned
            ? <ButtonLink href={`${base}/arrange`} variant="primary">Gäste anlegen und setzen</ButtonLink>
            : <ButtonLink href={`${base}/bookings/new`} variant="primary">Buchung anlegen</ButtonLink>}
          <a href={`${base}/export?${exportQuery}`} className={buttonClass()}>CSV-Export (aktuelle Auswahl)</a>
          <ButtonLink href={`${base}/print`}>Druckansicht</ButtonLink>
          <ButtonLink href={`${base}/print?view=cards`}>{event.mode === 'SEAT' ? 'Platzkarten' : 'Tischkarten'}</ButtonLink>
        </div>
      </Card>

      {event.rsvpEventId && !assigned && (
        <SettingsSection id="rsvp-sync" title="Zusagen aus rsvp-app" marker="pink">
          <RsvpSyncPanel eventId={event.id} assigned={false} changedSince={null} />
        </SettingsSection>
      )}

      <Card className="space-y-4">
        <form method="get" className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end" role="search">
          <div>
            <label htmlFor="booking-q" className={labelClass}>Suche</label>
            <input id="booking-q" name="q" type="search" defaultValue={query} maxLength={100} placeholder="Name, E-Mail, Telefon, Tisch" className={inputClass} />
          </div>
          <div>
            <label htmlFor="booking-status" className={labelClass}>Status</label>
            <select id="booking-status" name="status" defaultValue={filter} className={inputClass}>
              {LIST_FILTERS.map(f => <option key={f} value={f}>{LIST_FILTER_LABELS[f]}</option>)}
            </select>
          </div>
          <button type="submit" className={buttonClass('secondary')}>Anzeigen</button>
        </form>

        <h2 className="font-semibold">{bookings.length} {assigned ? (bookings.length === 1 ? 'Gruppe' : 'Gruppen') : `Buchung${bookings.length === 1 ? '' : 'en'}`} ({LIST_FILTER_LABELS[filter]}{query && `, Suche „${query}“`})</h2>
        {bookings.length === 0 ? (
          <EmptyState>{assigned ? 'Keine Gruppen in dieser Auswahl.' : 'Keine Buchungen in dieser Auswahl.'}</EmptyState>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700" data-testid="booking-list">
            {bookings.map(booking => {
              const status = effectiveStatus(booking, now)
              return (
                <li key={booking.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:gap-4">
                  <div className="font-medium sm:w-32 sm:shrink-0">{describePlaces(booking.allocations.map(a => a.unit)) || <span className="text-gray-500 dark:text-gray-400">ohne Platz</span>}</div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`${base}/bookings/${booking.id}`} className="font-medium text-blue-700 dark:text-blue-300 hover:underline">{booking.name}</Link>
                      <BookingStatusBadge status={status} />
                      <span className="text-gray-600 dark:text-gray-400">{booking.partySize} {booking.partySize === 1 ? 'Person' : 'Personen'}</span>
                    </div>
                    {booking.source === 'RSVP' && booking.rsvpPartySize !== null && booking.rsvpPartySize !== booking.partySize && status === 'CONFIRMED' && (
                      <p className="text-xs text-amber-800 dark:text-amber-200">rsvp-app: {booking.rsvpPartySize} Personen</p>
                    )}
                    {status === 'PENDING' && booking.expiresAt && <p className="text-xs text-gray-600 dark:text-gray-400">reserviert bis {formatDeadline(booking.expiresAt, tz, now)}</p>}
                    {status === 'OFFERED' && booking.expiresAt && <p className="text-xs text-gray-600 dark:text-gray-400">angeboten bis {formatDeadline(booking.expiresAt, tz, now)}</p>}
                    {status === 'WAITLISTED' && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">{booking.waitlistedAt ? `auf der Warteliste seit ${formatShort(booking.waitlistedAt, tz)}` : 'Warteliste, noch unbestätigt'}</p>
                    )}
                    {booking.attendees.length > 1 && <p className="text-xs text-gray-600 dark:text-gray-400">{booking.attendees.map(a => a.name).join(', ')}</p>}
                    {(booking.email || booking.phone) && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {booking.email && <a href={`mailto:${booking.email}`} className="hover:underline">{booking.email}</a>}
                        {booking.email && booking.phone && ' · '}
                        {booking.phone && <a href={`tel:${booking.phone.replace(/[^\d+]/g, '')}`} className="hover:underline">{booking.phone}</a>}
                      </p>
                    )}
                    {!assigned && !booking.email && <p className="text-xs text-gray-500 dark:text-gray-400">keine E-Mail</p>}
                    {booking.note && <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-line">{booking.note}</p>}
                    {booking.adminNote && <p className="text-xs text-purple-800 dark:text-purple-200 whitespace-pre-line">Intern: {booking.adminNote}</p>}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 sm:w-32 sm:shrink-0 sm:text-right">
                    {formatShort(booking.createdAt, tz)}
                    <span className="block">{BOOKING_SOURCE_LABELS[booking.source]}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {eventLog.length > 0 && (
        <SettingsSection id="history" title={assigned ? 'Verlauf: gelöschte Gruppen und Importe' : 'Verlauf: gelöschte Buchungen und Rundmails'} summary={`${eventLog.length} ${eventLog.length === 1 ? 'Eintrag' : 'Einträge'}`}>
          <ul className="text-sm divide-y divide-gray-100 dark:divide-gray-700">
            {eventLog.map(entry => (
              <li key={entry.id} className="py-1.5">
                <span className="text-gray-600 dark:text-gray-400">{formatShort(entry.createdAt, tz)} · {actorText(entry.actor, auditContext)}:</span> {auditText(entry)}
                {auditDetails(entry, auditContext).length > 0 && <span className="text-gray-600 dark:text-gray-400"> ({auditDetails(entry, auditContext).join('; ')})</span>}
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}
    </div>
  )
}
