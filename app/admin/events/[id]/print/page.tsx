// app/admin/events/[id]/print/page.tsx
import Link from 'next/link'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { activeWhere } from '../../../../lib/events/booking-tx'
import { effectiveStatus } from '../../../../lib/events/admin-rules'
import { describePlaces } from '../../../../lib/events/places'
import { formatRange } from '../../../../lib/timezone'
import PrintButton from '../../../../ui/print-button'

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
    <main className="bg-white py-6 px-4 print:p-0">
      <div className="max-w-4xl mx-auto space-y-4 text-gray-900">
        <div className="print:hidden flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm space-x-4">
            <Link href={`/admin/events/${event.id}/bookings`} className="text-blue-700 hover:underline">Zurück zu den Buchungen</Link>
            {cards
              ? <Link href={`/admin/events/${event.id}/print`} className="text-blue-700 hover:underline">{seatMode ? 'Platzliste' : 'Tischliste'}</Link>
              : <Link href={`/admin/events/${event.id}/print?view=cards`} className="text-blue-700 hover:underline">{seatMode ? 'Platzkarten' : 'Tischkarten'}</Link>}
          </p>
          <PrintButton />
        </div>

        {cards ? (
          <div className="grid grid-cols-2 gap-4">
            {rows.map(row => (
              <div key={row.id} className="border-2 border-gray-800 rounded p-6 text-center break-inside-avoid" data-testid="table-card">
                <p className="text-sm text-gray-600">{event.title}</p>
                <p className={`${seatMode ? 'text-xl' : 'text-3xl'} font-bold my-3`}>{row.label}</p>
                <p className="text-xl">{row.name}</p>
                <p className="text-sm text-gray-600">{row.partySize} {row.partySize === 1 ? 'Person' : 'Personen'}</p>
              </div>
            ))}
            {rows.length === 0 && <p className="text-sm text-gray-600">Keine Buchungen.</p>}
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold">{event.title} – {seatMode ? 'Platzliste' : 'Tischliste'}</h1>
              <p className="text-sm text-gray-600">{formatRange(event.startsAt, event.endsAt, event.timezone)}{event.location && ` · ${event.location}`} · {seatMode ? `${rows.length} Buchungen` : `${rows.length} Tische`}, {guests} Personen</p>
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
                  <tr key={row.id} className="border-b border-gray-300 align-top break-inside-avoid">
                    <td className="py-1 pr-3 font-medium">{row.label}</td>
                    <td className="py-1 pr-3">{row.name}{row.open === 'PENDING' && <span className="text-xs text-amber-800"> (unbestätigt)</span>}{row.open === 'OFFERED' && <span className="text-xs text-amber-800"> (Angebot offen)</span>}</td>
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
    </main>
  )
}
