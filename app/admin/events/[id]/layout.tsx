// app/admin/events/[id]/layout.tsx
import { requireUser } from '../../../lib/auth'
import { loadEventOr404 } from '../../../lib/events/store'
import { MODE_SHORT } from '../../../lib/events/settings'
import { formatRange } from '../../../lib/timezone'
import { Badge, ButtonLink, PageHeader, Tabs } from '../../../ui/kit'
import StatusBadge from '../../../ui/status-badge'
import EventFrame from './event-frame'

/**
 * Rahmen aller Seiten eines Events (docs/KONZEPT-OBERFLAECHE.md): Kopf mit Titel, Zeitraum, Status und Merkmalen,
 * „Öffentliche Seite ↗“, darunter die Reiter (auf dem Handy seitlich scrollbar). Beim Drucken ausgeblendet. Jede
 * Seite prüft den Zugriff selbst noch einmal (loadEventOr404) - das Layout allein schützt nichts.
 */
export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}`)
  const event = await loadEventOr404(id, user)
  const base = `/admin/events/${event.id}`
  const assigned = event.mode === 'ASSIGNED'
  const tabs = [
    { href: base, label: 'Übersicht', exact: true },
    { href: `${base}/bookings`, label: assigned ? 'Gäste' : 'Buchungen' },
    { href: `${base}/arrange`, label: assigned ? 'Sitzordnung' : 'Im Plan verschieben' },
    ...(assigned ? [] : [{ href: `${base}/mail`, label: 'Rundmail' }]),
    { href: `${base}/plan`, label: 'Raumplan' },
    { href: `${base}/settings`, label: 'Einstellungen' }
  ]
  const hidden = event.status === 'DRAFT' || event.status === 'ARCHIVED'
  return (
    <EventFrame>
      <div className="print:hidden">
        <PageHeader
          back={{ href: '/admin', label: 'Alle Events' }}
          title={event.title}
          subtitle={
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1">{formatRange(event.startsAt, event.endsAt, event.timezone)}{event.location && ` · ${event.location}`}</span>
              <StatusBadge status={event.status} />
              <Badge>{MODE_SHORT[event.mode]}</Badge>
              {event.level !== 'owner' && <Badge tone="teal">für dich freigegeben</Badge>}
              {event.access === 'RSVP' && <Badge tone="pink">nur mit Zusage</Badge>}
              {event.access !== 'RSVP' && event.rsvpEventId && <Badge tone="pink">mit rsvp-app</Badge>}
            </div>
          }
          actions={<ButtonLink href={`/${event.slug}`} external size="sm">{hidden ? 'Vorschau ↗' : 'Öffentliche Seite ↗'}</ButtonLink>}
        />
        <Tabs label="Bereiche des Events" items={tabs} />
      </div>
      {children}
    </EventFrame>
  )
}
