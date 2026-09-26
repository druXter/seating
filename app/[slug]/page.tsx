// app/[slug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { APP_NAME } from '../lib/app'
import { getCurrentUser } from '../lib/auth'
import { validateSlug } from '../lib/slugs'
import { formatDateTime, formatRange } from '../lib/timezone'
import { isPubliclyVisible, loadEventBySlug, loadEventForUser, loadUnitStates } from '../lib/events/store'
import { publicState } from '../lib/events/occupancy'
import { STATUS_LABELS } from '../lib/events/settings'
import Notice from '../ui/notice'
import EventPlan, { type PublicTable } from './event-plan'

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

function bookingNotice(event: { status: string; endsAt: Date; bookingOpensAt: Date | null; bookingClosesAt: Date | null; timezone: string }, now: Date): string {
  if (event.endsAt < now) return 'Diese Veranstaltung hat bereits stattgefunden.'
  if (event.status === 'CLOSED' || (event.bookingClosesAt && event.bookingClosesAt <= now)) return 'Die Buchung ist geschlossen.'
  if (event.bookingOpensAt && event.bookingOpensAt > now) return `Buchen kannst du ab ${formatDateTime(event.bookingOpensAt, event.timezone)}.`
  return 'Die Online-Buchung ist hier bald möglich.'
}

export default async function EventPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolved = await resolveEvent((await params).slug)
  if (!resolved) notFound()
  const { event, preview } = resolved
  const now = new Date()

  const { units, states } = await loadUnitStates(event.id, now)
  const tables: PublicTable[] = units
    .filter(unit => unit.kind === 'TABLE')
    .map(unit => ({ key: unit.key, label: unit.label, capacity: unit.capacity, state: publicState(states.get(unit.key) ?? 'free') }))
  const tableSeats = units
    .filter(unit => unit.kind === 'SEAT' && unit.tableKey !== null)
    .map(unit => ({ key: unit.key, tableKey: unit.tableKey as string }))
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

        <Notice tone="info">{bookingNotice(event, now)}</Notice>

        <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
          <EventPlan
            layout={event.layout}
            backgroundUrl={backgroundUrl}
            tables={tables}
            tableSeats={tableSeats}
            minFillRatio={event.minFillRatio}
            title={`Raumplan ${event.title}`}
          />
        </div>
      </div>
    </main>
  )
}
