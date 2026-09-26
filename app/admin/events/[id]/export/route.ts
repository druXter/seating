// app/admin/events/[id]/export/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { loadEventForUser } from '../../../../lib/events/store'
import { BOOKING_SOURCE_LABELS, BOOKING_STATUS_LABELS, effectiveStatus, matchesListFilter, matchesSearch, parseListFilter } from '../../../../lib/events/admin-rules'
import { toCsv } from '../../../../lib/csv'
import { formatShort } from '../../../../lib/timezone'

/**
 * CSV-Export der Buchungen (docs/KONZEPT.md Abschnitt 8) mit denselben Filtern wie die Liste
 * (?status=, ?q=). Nur lesend (GET). Ohne Anmeldung oder ohne Zugriff auf das Event: 404, ohne zu
 * verraten, ob es das Event gibt. Formel-Schutz und Excel-Format: app/lib/csv.ts.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  const event = user ? await loadEventForUser(id, user) : null
  if (!event) return new NextResponse('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

  const url = new URL(request.url)
  const filter = parseListFilter(url.searchParams.get('status') ?? undefined)
  const query = (url.searchParams.get('q') ?? '').slice(0, 100)
  const now = new Date()
  const tz = event.timezone

  const bookings = await prisma.booking.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'asc' },
    include: { allocations: { select: { unit: { select: { label: true } } } } }
  })
  const rows = bookings
    .map(b => ({ ...b, tables: b.allocations.map(a => a.unit.label) }))
    .filter(b => matchesListFilter(b, filter, now) && matchesSearch(b, query))
    .sort((a, b) => (a.tables[0] ?? '￿').localeCompare(b.tables[0] ?? '￿', 'de', { numeric: true }))
    .map(b => [
      b.tables.join(', '), b.name, b.email, b.phone, b.partySize, BOOKING_STATUS_LABELS[effectiveStatus(b, now)], BOOKING_SOURCE_LABELS[b.source],
      b.note, b.adminNote, formatShort(b.createdAt, tz), b.emailVerifiedAt ? formatShort(b.emailVerifiedAt, tz) : null
    ])

  const csv = toCsv([
    ['Tisch', 'Name', 'E-Mail', 'Telefon', 'Personen', 'Status', 'Quelle', 'Anmerkung', 'Interne Notiz', 'Gebucht am', 'E-Mail bestätigt am'],
    ...rows
  ])
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${event.slug}-buchungen.csv"`,
      'Cache-Control': 'no-store'
    }
  })
}
