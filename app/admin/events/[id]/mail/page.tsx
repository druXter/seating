// app/admin/events/[id]/mail/page.tsx
import Link from 'next/link'
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { activeWhere } from '../../../../lib/events/booking-tx'
import { MAIL_STATUS_LABELS, byLabel, effectiveStatus } from '../../../../lib/events/admin-rules'
import { isMailConfigured } from '../../../../lib/mail'
import { formatShort } from '../../../../lib/timezone'
import Notice from '../../../../ui/notice'
import BroadcastForm, { type BroadcastRecipient } from './broadcast-form'

export const dynamic = 'force-dynamic'

/**
 * Rundmail an die Buchenden (docs/KONZEPT.md Abschnitt 7): Formular mit Vorschau und Testversand,
 * darunter die bisherigen Rundmails mit ihrem Versandstand (Warteschlange, app/lib/events/broadcast.ts).
 */
export default async function MailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ queued?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/mail`)
  const event = await loadEventOr404(id, user)
  const { queued } = await searchParams
  const now = new Date()

  const [bookings, broadcasts] = await Promise.all([
    prisma.booking.findMany({
      where: { eventId: event.id, email: { not: null }, ...activeWhere(now) },
      select: { status: true, expiresAt: true, allocations: { select: { unit: { select: { key: true, label: true } } } } }
    }),
    prisma.broadcast.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { createdBy: { select: { email: true } }, mails: { select: { status: true } } }
    })
  ])
  const recipients: BroadcastRecipient[] = bookings
    .map(b => ({ status: effectiveStatus(b, now), tableKeys: b.allocations.map(a => a.unit.key) }))
    .filter((r): r is BroadcastRecipient => r.status === 'CONFIRMED' || r.status === 'PENDING')
  const tables = [...new Map(bookings.flatMap(b => b.allocations.map(a => [a.unit.key, { key: a.unit.key, label: a.unit.label }] as const))).values()].sort(byLabel)
  const queuedCount = Number.parseInt(queued ?? '', 10)

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-3xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm">
            <Link href={`/admin/events/${event.id}`} className="text-blue-700 hover:underline">{event.title}</Link>
            {' › '}
            <Link href={`/admin/events/${event.id}/bookings`} className="text-blue-700 hover:underline">Buchungen</Link>
          </p>
          <h1 className="text-2xl font-bold">Rundmail</h1>
        </div>

        {Number.isInteger(queuedCount) && queuedCount > 0 && (
          <Notice tone="success">
            Rundmail an {queuedCount} Empfänger*in{queuedCount === 1 ? '' : 'nen'} eingereiht. Sie wird jetzt nach und nach verschickt – den Stand siehst du unten.
          </Notice>
        )}
        {!isMailConfigured() && <Notice tone="warning">Es ist kein Mailserver eingerichtet (SMTP_HOST) – Rundmails lassen sich nicht verschicken.</Notice>}

        <div className="bg-white rounded-lg shadow p-4">
          <BroadcastForm
            eventId={event.id}
            event={{ title: event.title, location: event.location, startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone, mode: event.mode }}
            recipients={recipients}
            tables={tables}
          />
        </div>

        {broadcasts.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-bold">Bisherige Rundmails</h2>
              <Link href={`/admin/events/${event.id}/mail`} className="text-sm text-blue-700 hover:underline">Stand aktualisieren</Link>
            </div>
            <ul className="text-sm divide-y" data-testid="broadcasts">
              {broadcasts.map(broadcast => {
                const tally = new Map<string, number>()
                for (const mail of broadcast.mails) tally.set(mail.status, (tally.get(mail.status) ?? 0) + 1)
                return (
                  <li key={broadcast.id} className="py-2">
                    <p className="font-medium">{broadcast.subject}</p>
                    <p className="text-xs text-gray-600">
                      {formatShort(broadcast.createdAt, event.timezone)} · {broadcast.createdBy?.email ?? 'gelöschtes Konto'} ·{' '}
                      {[...tally].map(([status, n]) => `${n} ${MAIL_STATUS_LABELS[status] ?? status}`).join(', ')}
                    </p>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </main>
  )
}
