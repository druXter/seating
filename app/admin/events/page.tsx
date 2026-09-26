// app/admin/events/page.tsx
import Link from 'next/link'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { canCreateEvents } from '../../lib/permissions'
import { formatRange } from '../../lib/timezone'
import Notice from '../../ui/notice'
import StatusBadge from '../../ui/status-badge'

export const dynamic = 'force-dynamic'

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const user = await requireUser('/admin/events')
  const { deleted } = await searchParams

  // Admins sehen alle Events, alle anderen die eigenen und die ihnen freigegebenen -
  // dieselbe Regel wie eventLevel (app/lib/permissions.ts), hier nur als Abfrage.
  const events = await prisma.event.findMany({
    where: user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }] },
    orderBy: { startsAt: 'desc' },
    select: {
      id: true, slug: true, title: true, status: true, startsAt: true, endsAt: true, timezone: true, ownerId: true,
      owner: { select: { email: true } }
    }
  })

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">Events</h1>
            {canCreateEvents(user) && (
              <Link href="/admin/events/new" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">
                Neues Event
              </Link>
            )}
          </div>
          {deleted === '1' && <Notice tone="success">Event gelöscht.</Notice>}

          {events.length === 0 ? (
            <p className="text-sm text-gray-600">
              {canCreateEvents(user) ? 'Noch keine Events vorhanden.' : 'Dir wurden noch keine Events freigegeben.'}
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {events.map(event => (
                <li key={event.id} className="py-3">
                  <Link href={`/admin/events/${event.id}`} className="font-medium text-blue-700 hover:underline">{event.title}</Link>
                  {' '}<StatusBadge status={event.status} />
                  <div className="text-xs text-gray-600">
                    {formatRange(event.startsAt, event.endsAt, event.timezone)} · /{event.slug}
                    {event.ownerId !== user.id && ` · von ${event.owner?.email ?? 'gelöschtem Konto'}`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
