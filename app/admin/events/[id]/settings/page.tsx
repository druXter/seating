// app/admin/events/[id]/settings/page.tsx
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { baseUrl } from '../../../../lib/base-url'
import { loadEventOr404 } from '../../../../lib/events/store'
import { activeWhere } from '../../../../lib/events/booking-tx'
import { rsvpConfigured, seatingLinkFor } from '../../../../lib/rsvp/config'
import { utcToZonedInput } from '../../../../lib/timezone'
import { deleteEvent, shareEvent, unshareEvent } from '../../actions'
import { EventSettingsForm } from '../../event-forms'
import { buttonClass, Card, inputClass, SettingsSection, ConfirmForm, Notice } from '../../../../ui/kit'

export const dynamic = 'force-dynamic'

type Search = { section?: string; saved?: string; shared?: string; unshared?: string; shareError?: string }

/**
 * Einstellungen eines Events (docs/KONZEPT-OBERFLAECHE.md): das Formular in Abschnitten (Event · Buchung · Warteliste ·
 * Mails · Zugang und rsvp-app), darunter für Besitzer*in und Admins Freigaben und Löschen. `?section=<id>` öffnet
 * einen Abschnitt. Freigegebene Konten dürfen die Einstellungen ändern, aber nicht freigeben und nicht löschen.
 */
export default async function EventSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/settings`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const owner = event.level === 'owner'
  const tz = event.timezone

  const [shares, activeBookings] = await Promise.all([
    owner
      ? prisma.eventAccess.findMany({ where: { eventId: event.id }, include: { user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } })
      : Promise.resolve([]),
    owner ? prisma.booking.count({ where: { eventId: event.id, ...activeWhere(new Date()) } }) : Promise.resolve(0)
  ])

  return (
    <div className="space-y-3">
      {search.saved === '1' && <Notice tone="success">Einstellungen gespeichert.</Notice>}

      <EventSettingsForm
        eventId={event.id}
        baseUrl={baseUrl()}
        open={search.section}
        rsvp={{ available: rsvpConfigured(), seatingLink: seatingLinkFor(event.id) }}
        values={{
          title: event.title,
          slug: event.slug,
          description: event.description,
          location: event.location,
          startsAt: utcToZonedInput(event.startsAt, tz),
          endsAt: utcToZonedInput(event.endsAt, tz),
          mode: event.mode,
          access: event.access,
          rsvpEventId: event.rsvpEventId ?? '',
          bookingOpensAt: event.bookingOpensAt ? utcToZonedInput(event.bookingOpensAt, tz) : '',
          bookingClosesAt: event.bookingClosesAt ? utcToZonedInput(event.bookingClosesAt, tz) : '',
          minFillPercent: event.minFillRatio === null ? '' : String(Math.round(event.minFillRatio * 100)),
          pendingTtlMinutes: event.pendingTtlMinutes,
          selfEditHoursBefore: event.selfEditHoursBefore,
          oneBookingPerEmail: event.oneBookingPerEmail,
          requirePhone: event.requirePhone,
          waitlistEnabled: event.waitlistEnabled,
          offerTtlHours: event.offerTtlHours,
          maxSeatsPerBooking: event.maxSeatsPerBooking,
          replyTo: event.replyTo ?? '',
          mailNote: event.mailNote,
          guestSeatingVisible: event.guestSeatingVisible
        }}
      />

      {owner && (
        <SettingsSection id="shares" title="Freigaben" summary={shares.length === 0 ? 'keine' : shares.length === 1 ? '1 Konto' : `${shares.length} Konten`} marker="teal"
          open={search.section === 'shares' || search.shared !== undefined || search.unshared !== undefined || search.shareError !== undefined}
          description="Freigegebene Konten können das Event bearbeiten (Einstellungen, Plan, Buchungen) – aber nicht löschen und nicht weiter freigeben.">
          {search.shared === '1' && <Notice tone="success">Freigabe hinzugefügt.</Notice>}
          {search.unshared === '1' && <Notice tone="success">Freigabe entfernt.</Notice>}
          {search.shareError === 'notfound' && <Notice tone="error">Zu dieser Adresse gibt es kein Konto. Lade die Person zuerst unter „Konten“ ein.</Notice>}
          {search.shareError === 'owner' && <Notice tone="error">Diesem Konto gehört das Event bereits.</Notice>}
          {shares.length > 0 && (
            <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
              {shares.map(share => (
                <li key={share.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="truncate">{share.user.email}</span>
                  <form action={unshareEvent}>
                    <input type="hidden" name="accessId" value={share.id} />
                    <button type="submit" className={buttonClass('danger', 'sm')}>Entfernen</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={shareEvent} className="flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="eventId" value={event.id} />
            <label htmlFor="share-email" className="sr-only">E-Mail-Adresse des Kontos</label>
            <input id="share-email" name="email" type="email" required placeholder="E-Mail-Adresse des Kontos" className={`${inputClass} sm:flex-1`} />
            <button type="submit" className={buttonClass('primary')}>Freigeben</button>
          </form>
        </SettingsSection>
      )}

      {owner && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Event löschen</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Löscht das Event mit Plan, Buchungen und Freigaben endgültig.
            {activeBookings > 0 && ` Es hat ${activeBookings} aktive Buchung${activeBookings === 1 ? '' : 'en'} – die Buchenden werden nicht benachrichtigt. Wer Bescheid bekommen soll: vorher eine Rundmail schicken oder die Buchungen einzeln mit Mail stornieren.`}
          </p>
          <ConfirmForm
            action={deleteEvent}
            message={`Event „${event.title}“ endgültig löschen?${activeBookings > 0 ? ` ${activeBookings} aktive Buchung(en) gehen dabei verloren, ohne dass die Buchenden benachrichtigt werden.` : ''}`}
          >
            <input type="hidden" name="eventId" value={event.id} />
            <button type="submit" className={buttonClass('danger')}>Event löschen</button>
          </ConfirmForm>
        </Card>
      )}
    </div>
  )
}
