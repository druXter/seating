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
import Notice from '../../../../ui/notice'

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
        expiresAt: true, createdAt: true, waitlistedAt: true, emailVerifiedAt: true, allocations: { select: { unit: { select: { key: true, label: true, kind: true } } } }
      }
    }),
    prisma.auditLog.findMany({ where: { eventId: event.id, bookingId: null }, orderBy: { createdAt: 'desc' }, take: 20 })
  ])
  const unitKind = event.mode === 'SEAT' ? 'SEAT' : 'TABLE'
  const counts = countStates(units, states, unitKind)
  const confirmed = all.filter(b => effectiveStatus(b, now) === 'CONFIRMED')
  const guests = confirmed.reduce((sum, b) => sum + b.partySize, 0)
  const waitlist = all.filter(b => effectiveStatus(b, now) === 'WAITLISTED' && b.waitlistedAt !== null)
  const bookings = all
    .filter(b => matchesListFilter(b, filter, now))
    .filter(b => matchesSearch({ ...b, tables: b.allocations.map(a => a.unit.label) }, query))
  // Warteliste in ihrer Reihenfolge (Zeitpunkt der Bestätigung; unbestätigte zuletzt).
  if (filter === 'waitlist') bookings.sort((a, b) => (a.waitlistedAt?.getTime() ?? Infinity) - (b.waitlistedAt?.getTime() ?? Infinity))
  const auditContext = await loadAuditContext(event.id, eventLog.map(e => e.actor))

  const exportQuery = new URLSearchParams({ status: filter, ...(query ? { q: query } : {}) }).toString()
  const base = `/admin/events/${event.id}`

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-5xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm"><Link href={base} className="text-blue-700 hover:underline">{event.title}</Link></p>
          <h1 className="text-2xl font-bold">Buchungen</h1>
        </div>

        {search.deleted === '1' && <Notice tone="success">Buchung endgültig gelöscht.</Notice>}
        {search.mail === 'failed' && <Notice tone="warning">Die Mail an die Kund*in konnte nicht verschickt werden.</Notice>}

        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <p className="text-sm text-gray-700" data-testid="booking-counts">
            {unitKind === 'SEAT' ? 'Plätze' : 'Tische'}: {counts.free} frei · {counts.held} reserviert (unbestätigt) · {counts.confirmed} belegt
            {counts.unavailable > 0 && ` · ${counts.unavailable} nicht buchbar`} — {confirmed.length} bestätigte Buchung{confirmed.length === 1 ? '' : 'en'} mit {guests} Person{guests === 1 ? '' : 'en'}
            {waitlist.length > 0 && <> — <Link href={`${base}/bookings?status=waitlist`} className="text-blue-700 hover:underline">{waitlist.length} auf der Warteliste</Link></>}
            {!event.waitlistEnabled && ' — Warteliste aus'}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`${base}/bookings/new`} className="text-blue-700 hover:underline">Buchung anlegen</Link>
            <Link href={`${base}/mail`} className="text-blue-700 hover:underline">Rundmail</Link>
            <a href={`${base}/export?${exportQuery}`} className="text-blue-700 hover:underline">CSV-Export (aktuelle Auswahl)</a>
            <Link href={`${base}/print`} className="text-blue-700 hover:underline">Druckansicht</Link>
            <Link href={`${base}/print?view=cards`} className="text-blue-700 hover:underline">Tischkarten</Link>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <form method="get" className="flex flex-wrap items-end gap-2" role="search">
            <div className="grow">
              <label htmlFor="booking-q" className="block text-sm font-medium mb-1">Suche</label>
              <input id="booking-q" name="q" defaultValue={query} maxLength={100} placeholder="Name, E-Mail, Telefon, Tisch" className="w-full border border-gray-300 p-2 rounded text-sm" />
            </div>
            <div>
              <label htmlFor="booking-status" className="block text-sm font-medium mb-1">Status</label>
              <select id="booking-status" name="status" defaultValue={filter} className="border border-gray-300 p-2 rounded text-sm">
                {LIST_FILTERS.map(f => <option key={f} value={f}>{LIST_FILTER_LABELS[f]}</option>)}
              </select>
            </div>
            <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700 text-sm">Anzeigen</button>
          </form>

          <h2 className="font-bold">{bookings.length} Buchung{bookings.length === 1 ? '' : 'en'} ({LIST_FILTER_LABELS[filter]}{query && `, Suche „${query}“`})</h2>
          {bookings.length === 0 ? (
            <p className="text-sm text-gray-600">Keine Buchungen in dieser Auswahl.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th scope="col" className="py-1 pr-3">{unitKind === 'SEAT' ? 'Plätze' : 'Tisch'}</th>
                    <th scope="col" className="py-1 pr-3">Name</th>
                    <th scope="col" className="py-1 pr-3">Kontakt</th>
                    <th scope="col" className="py-1 pr-3">Personen</th>
                    <th scope="col" className="py-1 pr-3">Status</th>
                    <th scope="col" className="py-1">Gebucht</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map(booking => {
                    const status = effectiveStatus(booking, now)
                    return (
                      <tr key={booking.id} className="border-b last:border-0 align-top">
                        <td className="py-1 pr-3">{describePlaces(booking.allocations.map(a => a.unit))}</td>
                        <td className="py-1 pr-3">
                          <Link href={`${base}/bookings/${booking.id}`} className="text-blue-700 hover:underline">{booking.name}</Link>
                          {booking.note && <span className="block text-xs text-gray-600 whitespace-pre-line">{booking.note}</span>}
                          {booking.adminNote && <span className="block text-xs text-purple-800 whitespace-pre-line">Intern: {booking.adminNote}</span>}
                        </td>
                        <td className="py-1 pr-3">
                          {booking.email ?? <span className="text-gray-500">keine E-Mail</span>}
                          {booking.phone && <span className="block text-xs text-gray-600">{booking.phone}</span>}
                        </td>
                        <td className="py-1 pr-3">{booking.partySize}</td>
                        <td className="py-1 pr-3">
                          <BookingStatusBadge status={status} />
                          {status === 'PENDING' && booking.expiresAt && <span className="block text-xs text-gray-600">bis {formatDeadline(booking.expiresAt, tz, now)}</span>}
                          {status === 'OFFERED' && booking.expiresAt && <span className="block text-xs text-gray-600">angeboten bis {formatDeadline(booking.expiresAt, tz, now)}</span>}
                          {status === 'WAITLISTED' && (
                            <span className="block text-xs text-gray-600">{booking.waitlistedAt ? `seit ${formatShort(booking.waitlistedAt, tz)}` : 'noch unbestätigt'}</span>
                          )}
                        </td>
                        <td className="py-1 text-xs text-gray-600">
                          {formatShort(booking.createdAt, tz)}
                          <span className="block">{BOOKING_SOURCE_LABELS[booking.source]}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {eventLog.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4 space-y-2">
            <h2 className="font-bold">Verlauf: gelöschte Buchungen und Rundmails</h2>
            <ul className="text-sm divide-y">
              {eventLog.map(entry => (
                <li key={entry.id} className="py-1">
                  <span className="text-gray-600">{formatShort(entry.createdAt, tz)} · {actorText(entry.actor, auditContext)}:</span> {auditText(entry)}
                  {auditDetails(entry, auditContext).length > 0 && <span className="text-gray-600"> ({auditDetails(entry, auditContext).join('; ')})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}
