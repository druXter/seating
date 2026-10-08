// app/rsvp/[eventId]/page.tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { bookingSecretsConfigured, manageToken } from '../../lib/booking-tokens'
import { bookingWindow } from '../../lib/events/booking-rules'
import { loadUnitStates } from '../../lib/events/store'
import { publicState, tableFits } from '../../lib/events/occupancy'
import { seatPickerData } from '../../lib/events/places'
import { parseLayout } from '../../lib/floorplan/schema'
import { formatRange } from '../../lib/timezone'
import { isPubliclyVisible } from '../../lib/events/store'
import { activeRsvpBooking, verifySeatLink } from '../../lib/rsvp/booking'
import { partySizeOf } from '../../lib/rsvp/rules'
import Notice from '../../ui/notice'
import RsvpBooking from './rsvp-booking'
import GuestSeating from './guest-seating'
import { loadGuestSeating } from '../../lib/rsvp/guest-seating'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Sitzplatz wählen', robots: { index: false, follow: false } }

/**
 * Einstieg aus rsvp-app ("Sitzplatz wählen", docs/KONZEPT.md Abschnitt 9 A): /rsvp/<eventId>?t=<signierter
 * Link>. Ein GET ÄNDERT NICHTS - er prüft den Link und zeigt die Platzwahl; gebucht wird per POST
 * (app/rsvp/actions.ts). Gibt es zur Zusage schon eine Buchung, geht es direkt zur Verwaltungsseite.
 * Header: Regel "/:area(b|verify|rsvp)/:path*" in next.config.ts (no-store, no-referrer, noindex).
 * Ungültige Links sehen alle gleich aus - ob es das Event gibt, verrät die Seite nicht. Ist der Link echt,
 * das Event aber nicht über Zusagen buchbar (Sitzordnung, offener Zugang - rsvp-app kennt den Modus nicht),
 * gibt es einen passenden Hinweis; gebucht wird dann nichts (die Aktion prüft streng mit readSeatLink).
 */
export default async function RsvpEntryPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ t?: string | string[] }> }) {
  const { eventId } = await params
  const { t } = await searchParams
  const token = typeof t === 'string' ? t : ''
  const event = /^[a-z0-9]{10,40}$/.test(eventId) ? await prisma.event.findUnique({ where: { id: eventId } }) : null
  const link = event && token ? verifySeatLink(token, event) : null

  if (event && link && (event.mode === 'ASSIGNED' || event.access !== 'RSVP')) {
    const seating = await loadGuestSeating(event, link)
    return (
      <Shell>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-2">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-gray-700 dark:text-gray-300">{formatRange(event.startsAt, event.endsAt, event.timezone)}{event.location && ` · ${event.location}`}</p>
        </div>
        {seating ? (
          <GuestSeating view={seating} />
        ) : event.mode === 'ASSIGNED' ? (
          <Notice tone="info">
            Hallo {link.name}, die Sitzordnung legen die Veranstalter*innen fest – du musst hier nichts wählen. Dein Platz
            erscheint bei deiner Zusage in rsvp-app, sobald er feststeht.
          </Notice>
        ) : (
          <Notice tone="info">
            Hallo {link.name}, für diese Veranstaltung werden die Plätze hier frei gebucht, nicht über deine Zusage.{' '}
            {isPubliclyVisible(event.status)
              ? <>Buchen kannst du auf der <a href={`/${event.slug}`} className="underline">Seite der Veranstaltung</a>.</>
              : 'Die Buchung ist gerade nicht geöffnet.'}
          </Notice>
        )}
      </Shell>
    )
  }

  const layout = event ? parseLayout(event.layout) : null
  if (!event || !link || !layout?.ok) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Sitzplatz wählen</h1>
        <Notice tone="warning">
          Dieser Link ist ungültig oder abgelaufen. Öffne die Platzwahl bitte erneut über „Sitzplatz wählen“ bei deiner Zusage in rsvp-app.
        </Notice>
      </Shell>
    )
  }

  if (bookingSecretsConfigured()) {
    const existing = await activeRsvpBooking(event.id, link.rsvpEventId, link.rsvpId)
    if (existing) redirect(`/b/${existing.id}/${manageToken(existing.id, existing.manageTokenVersion)}`)
  }

  const now = new Date()
  const window = bookingWindow(event, now, 'RSVP')
  const partySize = partySizeOf(link)
  const open = window.open && bookingSecretsConfigured()
  const backgroundUrl = event.backgroundFile ? `/${event.slug}/background?v=${event.backgroundFile.slice(0, 8)}` : null

  let body: React.ReactNode
  if (event.mode === 'SEAT') {
    const { seats, groups } = await seatPickerData(event, now)
    body = <RsvpBooking eventId={event.id} token={token} open={open} partySize={partySize} layout={layout.layout} backgroundUrl={backgroundUrl} title={`Raumplan ${event.title}`} seats={{ seats, groups }} />
  } else {
    const { units, states } = await loadUnitStates(event.id, now)
    const tables = units.filter(u => u.kind === 'TABLE').map(u => ({
      key: u.key, label: u.label, capacity: u.capacity, state: publicState(states.get(u.key) ?? 'free'),
      fits: u.bookable && tableFits(u.capacity, partySize, event.minFillRatio)
    }))
    const tableSeats = units.filter(u => u.kind === 'SEAT' && u.tableKey).map(u => ({ key: u.key, tableKey: u.tableKey! }))
    body = <RsvpBooking eventId={event.id} token={token} open={open} partySize={partySize} layout={layout.layout} backgroundUrl={backgroundUrl} title={`Raumplan ${event.title}`} tables={{ tables, tableSeats }} />
  }

  return (
    <Shell>
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-2">
        <h1 className="text-2xl font-bold">{event.title}: Sitzplatz wählen</h1>
        <p className="text-gray-700 dark:text-gray-300">{formatRange(event.startsAt, event.endsAt, event.timezone)}{event.location && ` · ${event.location}`}</p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Hallo {link.name}, du hast in rsvp-app für <strong>{partySize} {partySize === 1 ? 'Person' : 'Personen'}</strong> zugesagt
          {link.companions.length > 0 && ` (mit ${link.companions.map(c => c ?? 'Begleitung').join(', ')})`}.
          {event.mode === 'SEAT' ? ` Wähle ${partySize === 1 ? 'deinen Platz' : `${partySize} Plätze`}.` : ' Wähle einen passenden Tisch.'}
          {' '}Die Personenzahl änderst du in rsvp-app.
        </p>
      </div>
      {!open && <Notice tone="info">{window.open ? 'Die Platzwahl ist gerade nicht möglich. Bitte versuch es später noch einmal.' : window.message}</Notice>}
      <div className="bg-white dark:bg-gray-800 p-4 sm:p-6 rounded-lg shadow">{body}</div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-4 text-gray-900 dark:text-gray-100">{children}</div>
    </main>
  )
}
