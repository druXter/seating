// app/admin/events/[id]/print/page.tsx
import { Segmented } from '../../../../ui/kit'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { activeWhere } from '../../../../lib/events/booking-tx'
import { effectiveStatus } from '../../../../lib/events/admin-rules'
import { describePlaces } from '../../../../lib/events/places'
import { formatRange } from '../../../../lib/timezone'
import PrintButton from '../../../../ui/print-button'
import SeatingPrint from './seating-print'

export const dynamic = 'force-dynamic'

/**
 * Druckansicht (docs/KONZEPT.md Abschnitt 8): Tisch- bzw. Platzliste für Einlass und Deko, mit ?view=cards
 * Tisch- bzw. Platzkarten (eine pro Buchung, Umbruch nie mitten in einer Karte). Nur aktive Buchungen;
 * unbestätigte sind markiert.
 */
export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/print`)
  const event = await loadEventOr404(id, user)
  const cards = (await searchParams).view === 'cards'
  if (event.mode === 'ASSIGNED') return <SeatingPrint event={event} cards={cards} />
  const now = new Date()

  // Eine Zeile bzw. Karte pro Buchung - im Modus SEAT mit ihren Plätzen zusammengefasst.
  const bookings = await prisma.booking.findMany({
    where: { eventId: event.id, ...activeWhere(now), allocations: { some: {} } },
    select: {
      id: true, name: true, partySize: true, note: true, status: true, expiresAt: true,
      allocations: { select: { unit: { select: { label: true, kind: true } } }, orderBy: { unit: { key: 'asc' } } }
    }
  })
  const rows = bookings
    .map(b => ({ ...b, label: describePlaces(b.allocations.map(a => a.unit)), sortKey: b.allocations[0]?.unit.label ?? '', open: effectiveStatus(b, now) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'de', { numeric: true }))
  const guests = rows.reduce((sum, r) => sum + r.partySize, 0)
  const seatMode = event.mode === 'SEAT'

  return (
    <div className="space-y-4">
        <div className="print:hidden flex flex-wrap items-center justify-between gap-2">
          <Segmented label="Druckart" items={[
            { href: `/admin/events/${event.id}/print`, label: seatMode ? 'Platzliste' : 'Tischliste', active: !cards },
            { href: `/admin/events/${event.id}/print?view=cards`, label: seatMode ? 'Platzkarten' : 'Tischkarten', active: cards }
          ]} />
          <PrintButton />
        </div>
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 dark:border-gray-700 dark:bg-gray-800 print:rounded-none print:border-0 print:p-0 print:shadow-none">

        {cards ? (
          <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            {rows.map(row => (
              <div key={row.id} className="border-2 border-gray-800 dark:border-gray-300 rounded-lg p-6 text-center break-inside-avoid" data-testid="table-card">
                <p className="text-sm text-gray-600 dark:text-gray-400">{event.title}</p>
                <p className={`${seatMode ? 'text-xl' : 'text-3xl'} font-bold my-3`}>{row.label}</p>
                <p className="text-xl">{row.name}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{row.partySize} {row.partySize === 1 ? 'Person' : 'Personen'}</p>
              </div>
            ))}
            {rows.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">Keine Buchungen.</p>}
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold">{event.title} – {seatMode ? 'Platzliste' : 'Tischliste'}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">{formatRange(event.startsAt, event.endsAt, event.timezone)}{event.location && ` · ${event.location}`} · {seatMode ? `${rows.length} Buchungen` : `${rows.length} Tische`}, {guests} Personen</p>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b-2 border-gray-800">
                  <th scope="col" className="py-1 pr-3">{seatMode ? 'Plätze' : 'Tisch'}</th>
                  <th scope="col" className="py-1 pr-3">Name</th>
                  <th scope="col" className="py-1 pr-3">Personen</th>
                  <th scope="col" className="py-1 pr-3">Anmerkung</th>
                  <th scope="col" className="py-1 w-8">✓</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-b border-gray-300 dark:border-gray-600 align-top break-inside-avoid">
                    <td className="py-1 pr-3 font-medium">{row.label}</td>
                    <td className="py-1 pr-3">{row.name}{row.open === 'PENDING' && <span className="text-xs text-amber-800 dark:text-amber-200"> (unbestätigt)</span>}{row.open === 'OFFERED' && <span className="text-xs text-amber-800 dark:text-amber-200"> (Angebot offen)</span>}</td>
                    <td className="py-1 pr-3">{row.partySize}</td>
                    <td className="py-1 pr-3 whitespace-pre-line">{row.note}</td>
                    <td className="py-1"><span className="inline-block w-4 h-4 border border-gray-800" aria-hidden="true" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        </div>
    </div>
  )
}
