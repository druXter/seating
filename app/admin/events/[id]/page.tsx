// app/admin/events/[id]/page.tsx
import Link from 'next/link'
import type { EventStatus } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { requireUser } from '../../../lib/auth'
import { baseUrl } from '../../../lib/base-url'
import { loadEventOr404, loadUnitStates } from '../../../lib/events/store'
import { activeWhere } from '../../../lib/events/booking-tx'
import { eventSummary } from '../../../lib/events/summary'
import { STATUS_HINTS, STATUS_LABELS } from '../../../lib/events/settings'
import { setEventStatus } from '../actions'
import PlanSvg, { type UnitVisual } from '../../../ui/plan/plan-svg'
import StatusBadge from '../../../ui/status-badge'
import { ButtonLink, buttonClass, Card, Stat, CopyableField, Notice } from '../../../ui/kit'

export const dynamic = 'force-dynamic'

type Search = { created?: string; status?: string }

/** Statuswechsel als Knöpfe: der naheliegende zuerst (blau), die übrigen daneben. */
const TRANSITIONS: Record<EventStatus, { to: EventStatus; label: string }[]> = {
  DRAFT: [{ to: 'OPEN', label: 'Veröffentlichen' }, { to: 'ARCHIVED', label: 'Archivieren' }],
  OPEN: [{ to: 'CLOSED', label: 'Buchung schließen' }, { to: 'DRAFT', label: 'Zurück zum Entwurf' }, { to: 'ARCHIVED', label: 'Archivieren' }],
  CLOSED: [{ to: 'OPEN', label: 'Buchung wieder öffnen' }, { to: 'ARCHIVED', label: 'Archivieren' }, { to: 'DRAFT', label: 'Zurück zum Entwurf' }],
  ARCHIVED: [{ to: 'OPEN', label: 'Wieder veröffentlichen' }, { to: 'DRAFT', label: 'Zurück zum Entwurf' }]
}

/**
 * Übersicht eines Events (docs/KONZEPT-OBERFLAECHE.md): Kennzahlen, Status mit Knöpfen, Link für Gäste, Plan mit
 * Belegung (Klick auf einen Tisch führt zur Buchung bzw. zum Anlegen) und die häufigsten Wege.
 */
export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const now = new Date()
  const base = `/admin/events/${event.id}`

  const assigned = event.mode === 'ASSIGNED'
  const unitKind = event.mode === 'TABLE' ? 'TABLE' : 'SEAT'
  const [{ units, states }, summary, bookings] = await Promise.all([
    loadUnitStates(event.id, now),
    eventSummary(event, now),
    // Aktive Buchungen (bestätigt oder noch gültig reserviert) - für die Links im Plan.
    prisma.booking.findMany({
      where: { eventId: event.id, ...activeWhere(now) },
      select: { id: true, name: true, allocations: { select: { unit: { select: { key: true } } } } }
    })
  ])
  const counts = summary.counts
  const bookableUnits = units.filter(u => u.kind === unitKind && u.bookable).length

  // Klick auf einen Tisch: belegt -> zur Buchung, frei -> Buchung anlegen (Konzept Abschnitt 8).
  const bookingByUnit = new Map(bookings.flatMap(b => b.allocations.map(a => [a.unit.key, b] as const)))
  const tableLabels = new Map(units.map(u => [u.key, u.label]))
  const tableKinds = new Map(units.map(u => [u.key, u.kind]))
  const visuals = new Map<string, UnitVisual>([...states].map(([key, state]) => {
    const booking = bookingByUnit.get(key)
    const label = tableLabels.get(key) ?? key
    // Sitzordnung: Personen setzt man in der Sitzordnung, der Plan hier zeigt nur die Belegung.
    if (assigned) return [key, { state: state === 'unavailable' ? 'free' : state, href: tableKinds.get(key) === 'SEAT' ? `${base}/arrange` : undefined, linkLabel: `${label}: zur Sitzordnung` }]
    if (booking) return [key, { state, href: `${base}/bookings/${booking.id}`, linkLabel: `${label}: Buchung von ${booking.name}` }]
    if (tableKinds.get(key) !== unitKind) return [key, { state }]
    if (state === 'free' || state === 'unavailable') return [key, { state, href: `${base}/bookings/new?table=${key}`, linkLabel: `${label}: Buchung anlegen` }]
    return [key, { state }]
  }))
  const publicUrl = `${baseUrl()}/${event.slug}`
  const backgroundUrl = event.backgroundFile ? `${base}/background?v=${event.layoutVersion}-${event.backgroundFile.slice(0, 8)}` : null
  const hidden = event.status === 'DRAFT' || event.status === 'ARCHIVED'
  const statusChanged = search.status && search.status in STATUS_LABELS ? STATUS_LABELS[search.status as EventStatus] : null
  const unitWord = unitKind === 'SEAT' ? 'Plätze' : 'Tische'

  return (
    <div className="space-y-6">
      {search.created === '1' && <Notice tone="success">Event angelegt. Es ist noch ein Entwurf – veröffentliche es unten unter „Status“, wenn alles passt.</Notice>}
      {statusChanged && <Notice tone="success">Status: {statusChanged}.</Notice>}
      {event.rsvpChangedAt && assigned && (
        <Notice tone="info">rsvp-app hat Änderungen an der Gästeliste gemeldet – bitte unter <Link href={`${base}/arrange`} className="underline">Sitzordnung</Link> abgleichen.</Notice>
      )}
      {!assigned && bookableUnits === 0 && (
        <Notice tone="warning">{unitKind === 'SEAT' ? 'Der Plan enthält keine buchbaren Plätze – füge im Raumplan Reihen, Stühle oder Tische mit Plätzen hinzu.' : 'Der Plan enthält keine buchbaren Tische – für eine Tischbuchung füge im Raumplan Tische hinzu.'}</Notice>
      )}

      {summary.kind === 'assigned' ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Mit Platz" value={`${summary.seated}/${summary.persons}`} progress={{ value: summary.seated, max: summary.persons }} hint={summary.persons === 1 ? 'Person' : 'Personen'} />
          <Stat label="Gruppen" value={summary.parties} />
          <Stat label="Plätze frei" value={counts.free + counts.unavailable} />
          <Stat label="Plätze besetzt" value={counts.confirmed} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={`${unitWord} belegt`} value={`${counts.confirmed + counts.held}/${summary.bookable}`} progress={{ value: counts.confirmed + counts.held, max: summary.bookable }}
            hint={counts.held > 0 ? `davon ${counts.held} unbestätigt` : undefined} />
          <Stat label={`${unitWord} frei`} value={counts.free} hint={counts.unavailable > 0 ? `${counts.unavailable} nicht buchbar` : undefined} />
          <Stat label="Buchungen" value={summary.bookings} hint={`${summary.guests} ${summary.guests === 1 ? 'Person' : 'Personen'}`} />
          <Stat label="Warteliste" value={event.waitlistEnabled || summary.waitlist > 0 ? summary.waitlist : 'aus'} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Status</h2>
            <StatusBadge status={event.status} />
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{STATUS_HINTS[event.status]}.</p>
          <div className="flex flex-wrap gap-2">
            {TRANSITIONS[event.status].map((transition, index) => (
              <form key={transition.to} action={setEventStatus}>
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="status" value={transition.to} />
                <button type="submit" className={buttonClass(index === 0 ? 'primary' : 'secondary')}>{transition.label}</button>
              </form>
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">Für Gäste</h2>
          <CopyableField label="Öffentlicher Link" value={publicUrl} />
          {hidden && <p className="text-xs text-gray-600 dark:text-gray-400">Öffentlich noch nicht sichtbar – nur Konten mit Zugriff sehen die Vorschau.</p>}
          {event.access === 'RSVP' && (
            <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="access-rsvp">
              Zugang: nur mit Zusage aus rsvp-app – Gäste wählen ihre {event.mode === 'SEAT' ? 'Plätze' : 'Tische'} über „Sitzplatz wählen“ in rsvp-app.
              Absagen dort stornieren die Buchung hier automatisch.
            </p>
          )}
          {assigned && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Keine Online-Buchung: Ihr legt die Gäste an (von Hand, per CSV{event.rsvpEventId ? ' oder per Abgleich mit rsvp-app' : ''}) und setzt sie in der
              Sitzordnung auf Plätze. Die öffentliche Seite zeigt nur den Plan, nie Namen.
            </p>
          )}
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Plan und Belegung</h2>
          <div className="flex flex-wrap gap-2">
            {assigned
              ? <ButtonLink href={`${base}/arrange`} variant="primary" size="sm">Gäste setzen</ButtonLink>
              : <ButtonLink href={`${base}/bookings/new`} variant="primary" size="sm">Buchung anlegen</ButtonLink>}
            <ButtonLink href={`${base}/print`} size="sm">Druckansicht</ButtonLink>
            <ButtonLink href={`${base}/print?view=cards`} size="sm">{event.mode === 'SEAT' ? 'Platzkarten' : 'Tischkarten'}</ButtonLink>
          </div>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="table-counts">
          {assigned
            ? `Plätze: ${counts.free + counts.unavailable} frei · ${counts.confirmed} besetzt`
            : <>
              {unitWord}: {counts.free} frei · {counts.held} reserviert (unbestätigt) · {counts.confirmed} belegt
              {counts.unavailable > 0 && ` · ${counts.unavailable} nicht buchbar`}
            </>}
        </p>
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <PlanSvg layout={event.layout} backgroundUrl={backgroundUrl} units={visuals} title={`Plan von ${event.title} mit Belegung`} className="block w-full h-auto max-h-[60vh]" />
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {assigned
            ? 'Ein Klick auf einen Platz öffnet die Sitzordnung.'
            : 'Ein Klick auf einen belegten Tisch bzw. Platz öffnet die Buchung, auf einen freien das Anlegen einer Buchung.'}
        </p>
      </Card>
    </div>
  )
}
