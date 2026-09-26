// app/[slug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { APP_NAME } from '../lib/app'
import { getCurrentUser } from '../lib/auth'
import { validateSlug } from '../lib/slugs'
import { formatDateTime, formatRange } from '../lib/timezone'
import { bookingAvailable } from '../lib/booking-mail'
import { bookingWindow, selfEditDeadline } from '../lib/events/booking-rules'
import { isPubliclyVisible, loadEventBySlug, loadEventForUser, loadUnitStates } from '../lib/events/store'
import { publicState } from '../lib/events/occupancy'
import { STATUS_LABELS } from '../lib/events/settings'
import Notice from '../ui/notice'
import EventPlan, { type PublicTable } from './event-plan'
import SeatBooking from './seat-booking'
import { seatPickerData } from '../lib/events/places'
import { largestTogether } from '../lib/events/seat-rules'

export const dynamic = 'force-dynamic'

/**
 * Öffentliche Eventseite /<slug>. Sichtbar sind veröffentlichte und geschlossene Events; Entwürfe
 * und archivierte Events ergeben 404 - außer für Konten mit Zugriff auf das Event (Vorschau).
 *
 * Datenschutz: Die Seite zeigt nur "frei/belegt", nie Namen oder Kontaktdaten Buchender (loadUnitStates
 * fragt sie gar nicht erst ab). Einbettbar per iFrame (Regel "/:slug" in next.config.ts), nicht
 * indexiert (robots-Metadaten) - Events werden per Link geteilt.
 */

const resolveEvent = cache(async (slug: string) => {
  if (validateSlug(slug) !== null) return null
  const event = await loadEventBySlug(slug)
  if (!event) return null
  if (isPubliclyVisible(event.status)) return { event, preview: false }
  // Nicht öffentlich: nur für Konten mit Zugriff (sonst nicht unterscheidbar von "gibt es nicht").
  const user = await getCurrentUser()
  if (user && (await loadEventForUser(event.id, user))) return { event, preview: true }
  return null
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const resolved = await resolveEvent((await params).slug)
  return {
    title: resolved ? `${resolved.event.title} – ${APP_NAME}` : APP_NAME,
    robots: { index: false, follow: false }
  }
}

/** Hinweis über dem Plan: ob und wie gebucht werden kann. */
function bookingState(event: Parameters<typeof bookingWindow>[0] & { selfEditHoursBefore: number }, now: Date): { open: boolean; message: string } {
  const what = event.mode === 'SEAT' ? 'Wähle freie Plätze und reserviere sie' : 'Wähle einen freien Tisch und reserviere ihn'
  const window = bookingWindow(event, now)
  if (!window.open) return { open: false, message: window.message }
  if (!bookingAvailable()) return { open: false, message: 'Die Online-Buchung ist gerade nicht möglich. Bitte versuche es später noch einmal.' }
  return {
    open: true,
    message: `${what}. Nach der Bestätigung per Mail kannst du deine Buchung bis ${formatDateTime(selfEditDeadline(event), event.timezone)} selbst ändern oder stornieren.`
  }
}

export default async function EventPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveEvent((await params).slug)
  if (!resolved) notFound()
  const { event, preview } = resolved
  const now = new Date()

  const { units, states } = await loadUnitStates(event.id, now)
  const tables: PublicTable[] = units
    .filter(unit => unit.kind === 'TABLE')
    .map(unit => ({ key: unit.key, label: unit.label, capacity: unit.capacity, bookable: unit.bookable, state: publicState(states.get(unit.key) ?? 'free') }))
  const tableSeats = units
    .filter(unit => unit.kind === 'SEAT' && unit.tableKey !== null)
    .map(unit => ({ key: unit.key, tableKey: unit.tableKey as string }))
  const booking = bookingState(event, now)
  // Modus SEAT: Plätze statt Tische (nur Schlüssel, Beschriftung, Zustand - keine Angaben zu Buchungen).
  const seatData = event.mode === 'SEAT' ? await seatPickerData(event, now) : null
  const backgroundUrl = event.backgroundFile ? `/${event.slug}/background?v=${event.backgroundFile.slice(0, 8)}` : null

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-4 text-gray-900">
        {preview && (
          <Notice tone="warning">
            Vorschau: Dieses Event ist „{STATUS_LABELS[event.status]}“ und öffentlich nicht sichtbar.{' '}
            <Link href={`/admin/events/${event.id}`} className="underline">Zur Verwaltung</Link>
          </Notice>
        )}

        <div className="bg-white p-6 rounded-lg shadow space-y-2">
          <h1 className="text-2xl font-bold">{event.title}</h1>
          <p className="text-gray-700">{formatRange(event.startsAt, event.endsAt, event.timezone)}</p>
          {event.location && <p className="text-gray-700">{event.location}</p>}
          {event.description && <p className="text-sm text-gray-700 whitespace-pre-line pt-2">{event.description}</p>}
        </div>

        <Notice tone="info">{booking.message}</Notice>

        <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
          {seatData ? (
            <SeatBooking
              layout={event.layout}
              backgroundUrl={backgroundUrl}
              title={`Raumplan ${event.title}`}
              seats={seatData.seats}
              groups={seatData.groups}
              maxSeats={event.maxSeatsPerBooking}
              largestGroup={largestTogether(seatData.groups, new Set(seatData.seats.filter(s => s.state !== 'unavailable').map(s => s.key)))}
              booking={{ eventId: event.id, open: booking.open, requirePhone: event.requirePhone, waitlist: event.waitlistEnabled }}
            />
          ) : (
          <EventPlan
            layout={event.layout}
            backgroundUrl={backgroundUrl}
            tables={tables}
            tableSeats={tableSeats}
            minFillRatio={event.minFillRatio}
            title={`Raumplan ${event.title}`}
            booking={{ eventId: event.id, open: booking.open, requirePhone: event.requirePhone, waitlist: event.waitlistEnabled }}
          />
          )}
        </div>
      </div>
    </main>
  )
}
