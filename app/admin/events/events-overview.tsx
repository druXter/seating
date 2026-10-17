// app/admin/events/events-overview.tsx
import Link from 'next/link'
import type { EventMode, EventStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import type { CurrentUser } from '../../lib/auth'
import { canCreateEvents } from '../../lib/permissions'
import { formatRange } from '../../lib/timezone'
import { MODE_SHORT } from '../../lib/events/settings'
import { eventSummary, type EventSummary } from '../../lib/events/summary'
import { Badge, ButtonLink, EmptyState, Main, PageHeader, ProgressBar, sectionTitleClass } from '../../ui/kit'
import StatusBadge from '../../ui/status-badge'
import Notice from '../../ui/notice'
import InstallHint from '../../ui/install-hint'

type Row = {
  id: string; title: string; status: EventStatus; mode: EventMode; timezone: string; startsAt: Date; endsAt: Date
  location: string; shared: boolean; owner: string | null; rsvp: boolean; summary: EventSummary | null
}

const MONTH = (timeZone: string) => new Intl.DateTimeFormat('de-DE', { timeZone, month: 'short' })
const DAY = (timeZone: string) => new Intl.DateTimeFormat('de-DE', { timeZone, day: '2-digit' })

/**
 * Übersicht „Events“ (docs/KONZEPT-OBERFLAECHE.md) unter /admin und /admin/events: Aktuell (nicht archiviert und
 * noch nicht vorbei, nach Beginn) und eingeklappt Vergangen (archiviert oder vorbei, neueste zuerst). Aktuelle Events
 * zeigen ihre Belegung. Admins sehen alle Events mit Besitz.
 */
export default async function EventsOverview({ user, deleted }: { user: CurrentUser; deleted: boolean }) {
  const now = new Date()
  // Admins sehen alle Events, alle anderen die eigenen und die ihnen freigegebenen -
  // dieselbe Regel wie eventLevel (app/lib/permissions.ts), hier nur als Abfrage.
  const events = await prisma.event.findMany({
    where: user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }] },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true, title: true, status: true, mode: true, startsAt: true, endsAt: true, timezone: true, location: true, ownerId: true,
      rsvpEventId: true, owner: { select: { email: true } }, shares: { where: { userId: user.id }, select: { id: true } }
    }
  })
  const isCurrent = (event: { status: EventStatus; endsAt: Date }) => event.status !== 'ARCHIVED' && event.endsAt >= now
  const rows: Row[] = await Promise.all(events.map(async event => ({
    id: event.id, title: event.title, status: event.status, mode: event.mode, timezone: event.timezone,
    startsAt: event.startsAt, endsAt: event.endsAt, location: event.location, rsvp: event.rsvpEventId !== null,
    shared: event.ownerId !== user.id && event.shares.length > 0,
    owner: event.ownerId !== user.id && user.role === 'ADMIN' ? event.owner?.email ?? 'gelöschtes Konto' : null,
    // Belegung nur für aktuelle Events - vergangene brauchen sie in der Übersicht nicht.
    summary: isCurrent(event) ? await eventSummary(event, now) : null
  })))
  const current = rows.filter(isCurrent)
  const past = rows.filter(row => !isCurrent(row)).reverse()

  return (
    <Main>
      <PageHeader
        title="Events"
        subtitle={canCreateEvents(user) ? 'Raumpläne für Events übernehmen, Buchungen verwalten und Sitzordnungen planen.' : 'Die Events, die für dich freigegeben wurden.'}
        actions={canCreateEvents(user) ? <ButtonLink href="/admin/events/new" variant="primary">Neues Event</ButtonLink> : undefined}
      />
      <div className="space-y-6">
        {deleted && <Notice tone="success">Event gelöscht.</Notice>}
        {rows.length === 0 && (
          <EmptyState>{canCreateEvents(user) ? 'Noch keine Events. Lege oben das erste an.' : 'Dir wurden noch keine Events freigegeben.'}</EmptyState>
        )}
        {current.length > 0 && (
          <section>
            <h2 className={sectionTitleClass}>Aktuell</h2>
            <ul className="space-y-3">{current.map(row => <EventRow key={row.id} row={row} />)}</ul>
          </section>
        )}
        {past.length > 0 && (
          <details className="group">
            <summary className={`${sectionTitleClass} cursor-pointer list-none`}>
              <span className="inline-block transition group-open:rotate-90" aria-hidden>▸</span> Vergangen ({past.length})
            </summary>
            <ul className="space-y-3">{past.map(row => <EventRow key={row.id} row={row} muted />)}</ul>
          </details>
        )}
        <InstallHint />
      </div>
    </Main>
  )
}

function EventRow({ row, muted = false }: { row: Row; muted?: boolean }) {
  return (
    <li className={`rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-blue-300 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700 ${muted ? 'opacity-75' : ''}`} data-testid="event-row">
      <Link href={`/admin/events/${row.id}`} className="group flex gap-4 p-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center self-start rounded-lg bg-gray-50 py-2 text-center dark:bg-gray-900">
          <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{MONTH(row.timezone).format(row.startsAt)}</span>
          <span className="text-xl font-semibold leading-tight">{DAY(row.timezone).format(row.startsAt)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">{row.title}</span>
            <StatusBadge status={row.status} />
            <Badge>{MODE_SHORT[row.mode]}</Badge>
            {row.rsvp && <Badge tone="pink">mit rsvp-app</Badge>}
            {row.shared && <Badge tone="teal">freigegeben</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {formatRange(row.startsAt, row.endsAt, row.timezone)}{row.location ? ` · ${row.location}` : ''}{row.owner ? ` · ${row.owner}` : ''}
          </p>
          {row.summary && <SummaryLine summary={row.summary} />}
        </div>
      </Link>
    </li>
  )
}

/** Belegung in einer Zeile, mit Balken: belegte bzw. reservierte Tische/Plätze oder Personen mit Platz. */
function SummaryLine({ summary }: { summary: EventSummary }) {
  if (summary.kind === 'assigned') {
    return (
      <div className="mt-2 max-w-md text-sm text-gray-700 dark:text-gray-300" data-testid="event-row-stats">
        <span><strong className="font-semibold">{summary.seated}</strong> von {summary.persons} {summary.persons === 1 ? 'Person hat' : 'Personen haben'} einen Platz</span>
        {summary.persons > 0 && <ProgressBar value={summary.seated} max={summary.persons} />}
      </div>
    )
  }
  const taken = summary.counts.confirmed + summary.counts.held
  const unit = summary.unit === 'SEAT' ? 'Plätze' : 'Tische'
  return (
    <div className="mt-2 max-w-md text-sm text-gray-700 dark:text-gray-300" data-testid="event-row-stats">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span><strong className="font-semibold">{taken}</strong> von {summary.bookable} {unit} belegt</span>
        <span><strong className="font-semibold">{summary.bookings}</strong> {summary.bookings === 1 ? 'Buchung' : 'Buchungen'}, {summary.guests} {summary.guests === 1 ? 'Person' : 'Personen'}</span>
        {summary.waitlist > 0 && <span><strong className="font-semibold">{summary.waitlist}</strong> auf der Warteliste</span>}
      </div>
      {summary.bookable > 0 && <ProgressBar value={taken} max={summary.bookable} />}
    </div>
  )
}
