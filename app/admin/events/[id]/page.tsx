// app/admin/events/[id]/page.tsx
import Link from 'next/link'
import { prisma } from '../../../lib/prisma'
import { requireUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { loadPlan } from '../../../lib/floorplan/store'
import { loadEventOr404, loadUnitStates } from '../../../lib/events/store'
import { countStates } from '../../../lib/events/occupancy'
import { activeWhere } from '../../../lib/events/booking-tx'
import { formatRange, utcToZonedInput } from '../../../lib/timezone'
import { deleteEvent, removeEventBackground, shareEvent, unshareEvent } from '../actions'
import { EventSettingsForm, ResyncForm } from '../event-forms'
import PlanSvg, { type UnitVisual } from '../../../ui/plan/plan-svg'
import BackgroundCard, { BackgroundNotice } from '../../../ui/background-card'
import CopyableField from '../../../ui/copyable-field'
import ConfirmForm from '../../../ui/confirm-form'
import StatusBadge from '../../../ui/status-badge'
import Notice from '../../../ui/notice'

export const dynamic = 'force-dynamic'

type Search = {
  created?: string; settings?: string; shared?: string; unshared?: string; shareError?: string; resynced?: string; background?: string
}

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const now = new Date()

  const { units, states } = await loadUnitStates(event.id, now)
  const counts = countStates(units, states, 'TABLE')
  const bookableTables = units.filter(u => u.kind === 'TABLE' && u.bookable).length

  // Aktive Buchungen (bestätigt oder noch gültig reserviert) - für die Links im Plan und die Warnung beim Löschen.
  const [bookings, shares, sourcePlan] = await Promise.all([
    prisma.booking.findMany({
      where: { eventId: event.id, ...activeWhere(now) },
      select: { id: true, name: true, allocations: { select: { unit: { select: { key: true } } } } }
    }),
    event.level === 'owner'
      ? prisma.eventAccess.findMany({ where: { eventId: event.id }, include: { user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } })
      : Promise.resolve([]),
    event.sourcePlanId ? loadPlan(event.sourcePlanId, user) : Promise.resolve(null)
  ])

  const activeBookings = bookings.length
  // Klick auf einen Tisch: belegt -> zur Buchung, frei -> Buchung anlegen (Konzept Abschnitt 8).
  const bookingByUnit = new Map(bookings.flatMap(b => b.allocations.map(a => [a.unit.key, b] as const)))
  const tableLabels = new Map(units.map(u => [u.key, u.label]))
  const visuals = new Map<string, UnitVisual>([...states].map(([key, state]) => {
    const booking = bookingByUnit.get(key)
    const label = tableLabels.get(key) ?? key
    if (booking) return [key, { state, href: `/admin/events/${event.id}/bookings/${booking.id}`, linkLabel: `${label}: Buchung von ${booking.name}` }]
    if (state === 'free' || state === 'unavailable') return [key, { state, href: `/admin/events/${event.id}/bookings/new?table=${key}`, linkLabel: `${label}: Buchung anlegen` }]
    return [key, { state }]
  }))
  const publicUrl = `${baseUrl()}/${event.slug}`
  const backgroundUrl = event.backgroundFile ? `/admin/events/${event.id}/background?v=${event.layoutVersion}-${event.backgroundFile.slice(0, 8)}` : null
  const tz = event.timezone

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-5xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm"><Link href="/admin/events" className="text-blue-700 hover:underline">Alle Events</Link></p>
          <h1 className="text-2xl font-bold">{event.title} <StatusBadge status={event.status} /></h1>
          <p className="text-sm text-gray-600">{formatRange(event.startsAt, event.endsAt, tz)}{event.location && ` · ${event.location}`}</p>
        </div>

        {search.created === '1' && <Notice tone="success">Event angelegt. Es ist noch ein Entwurf – veröffentliche es unten unter „Status“, wenn alles passt.</Notice>}
        {search.settings === '1' && <Notice tone="success">Einstellungen gespeichert.</Notice>}
        {search.resynced === '1' && <Notice tone="success">Plan aus der Vorlage übernommen.</Notice>}
        {search.shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
        {search.unshared === '1' && <Notice tone="success">Freigabe entfernt.</Notice>}
        {search.shareError === 'notfound' && <Notice tone="error">Zu dieser Adresse gibt es kein Konto. Lade die Person zuerst unter „Nutzer*innen“ ein.</Notice>}
        {search.shareError === 'owner' && <Notice tone="error">Diesem Konto gehört das Event bereits.</Notice>}
        <BackgroundNotice outcome={search.background} />

        <div className="bg-white rounded-lg shadow p-4 space-y-2">
          <CopyableField label="Öffentlicher Link" value={publicUrl} />
          <p className="text-sm">
            <a href={`/${event.slug}`} className="text-blue-700 hover:underline">
              {event.status === 'DRAFT' || event.status === 'ARCHIVED' ? 'Vorschau ansehen' : 'Öffentliche Seite ansehen'}
            </a>
            {(event.status === 'DRAFT' || event.status === 'ARCHIVED') && (
              <span className="text-gray-600"> – öffentlich noch nicht sichtbar, nur Konten mit Zugriff sehen die Vorschau.</span>
            )}
          </p>
        </div>

        {event.mode === 'TABLE' && bookableTables === 0 && (
          <Notice tone="warning">Der Plan enthält keine buchbaren Tische – für eine Tischbuchung füge im Plan Tische hinzu.</Notice>
        )}

        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">Plan und Belegung</h2>
            <Link href={`/admin/events/${event.id}/plan`} className="text-sm text-blue-700 hover:underline">Plan bearbeiten</Link>
          </div>
          <p className="text-sm text-gray-700" data-testid="table-counts">
            Tische: {counts.free} frei · {counts.held} reserviert (unbestätigt) · {counts.confirmed} belegt
            {counts.unavailable > 0 && ` · ${counts.unavailable} nicht buchbar`}
          </p>
          <PlanSvg layout={event.layout} backgroundUrl={backgroundUrl} units={visuals} title={`Plan von ${event.title} mit Belegung`} className="w-full h-auto max-h-[60vh]" />
          <p className="text-xs text-gray-600">
            Kopie der Vorlage {event.sourcePlanId ? (sourcePlan ? `„${sourcePlan.name}“` : '(für dich nicht sichtbar)') : '(inzwischen gelöscht)'}.
            Änderungen an der Vorlage wirken sich nicht auf dieses Event aus.
          </p>
          {sourcePlan && <ResyncForm eventId={event.id} layoutVersion={event.layoutVersion} planName={sourcePlan.name} />}
        </div>

        <div className="bg-white rounded-lg shadow p-4 space-y-2">
          <h2 className="font-bold">Buchungen ({activeBookings} aktiv)</h2>
          <p className="text-sm space-x-4">
            <Link href={`/admin/events/${event.id}/bookings`} className="text-blue-700 hover:underline">Buchungen verwalten</Link>
            <Link href={`/admin/events/${event.id}/bookings/new`} className="text-blue-700 hover:underline">Buchung anlegen</Link>
            <Link href={`/admin/events/${event.id}/mail`} className="text-blue-700 hover:underline">Rundmail</Link>
            <Link href={`/admin/events/${event.id}/print`} className="text-blue-700 hover:underline">Druckansicht</Link>
          </p>
          <p className="text-xs text-gray-600">Im Plan führt ein Klick auf einen belegten Tisch zur Buchung, auf einen freien zum Anlegen einer Buchung.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="bg-white rounded-lg shadow p-4 space-y-3">
            <h2 className="font-bold">Einstellungen</h2>
            <EventSettingsForm
              eventId={event.id}
              baseUrl={baseUrl()}
              values={{
                title: event.title,
                slug: event.slug,
                description: event.description,
                location: event.location,
                startsAt: utcToZonedInput(event.startsAt, tz),
                endsAt: utcToZonedInput(event.endsAt, tz),
                mode: event.mode,
                bookingOpensAt: event.bookingOpensAt ? utcToZonedInput(event.bookingOpensAt, tz) : '',
                bookingClosesAt: event.bookingClosesAt ? utcToZonedInput(event.bookingClosesAt, tz) : '',
                minFillPercent: event.minFillRatio === null ? '' : String(Math.round(event.minFillRatio * 100)),
                status: event.status,
                pendingTtlMinutes: event.pendingTtlMinutes,
                selfEditHoursBefore: event.selfEditHoursBefore,
                oneBookingPerEmail: event.oneBookingPerEmail,
                requirePhone: event.requirePhone,
                waitlistEnabled: event.waitlistEnabled,
                offerTtlHours: event.offerTtlHours,
                replyTo: event.replyTo ?? '',
                mailNote: event.mailNote
              }}
            />
          </div>

          <div className="space-y-4">
            <BackgroundCard
              uploadUrl={`/admin/events/${event.id}/background`} hasBackground={event.backgroundFile !== null}
              removeAction={removeEventBackground} idField="eventId" id={event.id}
            />

            {event.level === 'owner' && (
              <div className="bg-white rounded-lg shadow p-4 space-y-3">
                <h2 className="font-bold">Freigaben</h2>
                <p className="text-xs text-gray-600">
                  Freigegebene Konten können das Event bearbeiten (Einstellungen, Plan, Buchungen) – aber nicht löschen
                  und nicht weiter freigeben.
                </p>
                {shares.length > 0 && (
                  <ul className="text-sm divide-y">
                    {shares.map(share => (
                      <li key={share.id} className="py-1 flex items-center justify-between gap-2">
                        <span>{share.user.email}</span>
                        <form action={unshareEvent}>
                          <input type="hidden" name="accessId" value={share.id} />
                          <button type="submit" className="text-xs text-red-700 hover:underline">Entfernen</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={shareEvent} className="flex gap-2">
                  <input type="hidden" name="eventId" value={event.id} />
                  <label htmlFor="share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
                  <input id="share-email" name="email" type="email" required placeholder="E-Mail-Adresse des Kontos" className="grow border border-gray-300 p-2 rounded text-sm" />
                  <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700 text-sm">Freigeben</button>
                </form>
              </div>
            )}

            {event.level === 'owner' && (
              <div className="bg-white rounded-lg shadow p-4 space-y-2">
                <h2 className="font-bold">Event löschen</h2>
                <p className="text-xs text-gray-600">
                  Löscht das Event mit Plan, Buchungen und Freigaben endgültig.
                  {activeBookings > 0 && ` Es hat ${activeBookings} aktive Buchung${activeBookings === 1 ? '' : 'en'} – die Buchenden werden nicht benachrichtigt. Wer Bescheid bekommen soll: vorher eine Rundmail schicken oder die Buchungen einzeln mit Mail stornieren.`}
                </p>
                <ConfirmForm
                  action={deleteEvent}
                  message={`Event „${event.title}“ endgültig löschen?${activeBookings > 0 ? ` ${activeBookings} aktive Buchung(en) gehen dabei verloren, ohne dass die Buchenden benachrichtigt werden.` : ''}`}
                >
                  <input type="hidden" name="eventId" value={event.id} />
                  <button type="submit" className="text-sm text-red-700 hover:underline">Event löschen</button>
                </ConfirmForm>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
