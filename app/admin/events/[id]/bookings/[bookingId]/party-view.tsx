// app/admin/events/[id]/bookings/[bookingId]/party-view.tsx
import { Notice, SubmitButton } from '../../../../../ui/kit'
import Link from 'next/link'
import { prisma } from '../../../../../lib/prisma'
import type { LoadedEvent } from '../../../../../lib/events/store'
import type { AdminBooking } from '../../../../../lib/events/admin-booking'
import { loadAuditContext } from '../../../../../lib/events/admin-booking'
import { ADMIN_NOTE_MAX, BOOKING_SOURCE_LABELS, effectiveStatus } from '../../../../../lib/events/admin-rules'
import { BOOKING_LIMITS } from '../../../../../lib/events/booking-rules'
import { ATTENDEE_NAME_MAX } from '../../../../../lib/events/assign-rules'
import { actorText, auditDetails, auditText } from '../../../../../lib/events/audit-text'
import { formatShort } from '../../../../../lib/timezone'
import { cancelBookingAdmin, deleteBookingAdmin, saveAdminNote } from '../../../booking-actions'
import { updatePartyAction } from '../../../arrange-actions'
import ActionForm from '../../../../../ui/action-form'
import BookingStatusBadge from '../../../../../ui/booking-status-badge'

const DONE: Record<string, string> = {
  party: 'Gruppe gespeichert.',
  unchanged: 'Es gab nichts zu ändern.',
  note: 'Interne Notiz gespeichert.',
  cancelled: 'Gruppe abgesagt, ihre Plätze sind wieder frei.'
}

const input = 'w-full rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900'
const labelClass = 'block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1'
const card = 'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 sm:p-5 space-y-3'

/**
 * Eine Gruppe der Sitzordnung (Modus ASSIGNED, docs/KONZEPT.md Abschnitt 8): Personen mit Platz,
 * bearbeiten (Name, Personen umbenennen, entfernen, hinzufügen), interne Notiz, absagen, löschen,
 * Verlauf. Keine Kontaktdaten, keine Mails, kein Verwaltungslink. Plätze setzt man in der Sitzordnung.
 */
export default async function PartyView({ event, booking, done }: { event: LoadedEvent; booking: AdminBooking; done?: string }) {
  const now = new Date()
  const tz = event.timezone
  const status = effectiveStatus(booking, now)
  const active = status === 'CONFIRMED'
  const [attendees, auditLog] = await Promise.all([
    prisma.attendee.findMany({
      where: { bookingId: booking.id }, orderBy: { position: 'asc' },
      select: { id: true, name: true, allocation: { select: { unit: { select: { label: true } } } } }
    }),
    prisma.auditLog.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } })
  ])
  const auditContext = await loadAuditContext(event.id, auditLog.map(e => e.actor))
  const base = `/admin/events/${event.id}`
  const hidden = (
    <>
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="bookingId" value={booking.id} />
    </>
  )

  return (
    <div className="space-y-4">
        <div className="space-y-1">
          <p className="flex flex-wrap gap-x-4 text-sm">
            <Link href={`${base}/bookings`} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Alle Gäste</Link>
            <Link href={`${base}/arrange`} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">← Sitzordnung</Link>
          </p>
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold">{booking.name} <BookingStatusBadge status={status} /></h2>
        </div>

        {done && DONE[done] && <Notice tone={done === 'unchanged' ? 'info' : 'success'}>{DONE[done]}</Notice>}

        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className={card}>
              <h2 className="font-semibold">Personen ({attendees.length})</h2>
              <ul className="text-sm divide-y divide-gray-100 dark:divide-gray-700" data-testid="party-persons">
                {attendees.map(person => (
                  <li key={person.id} className="py-1 flex justify-between gap-2">
                    <span>{person.name}</span>
                    <span className={person.allocation ? 'text-gray-700 dark:text-gray-300' : 'text-amber-800 dark:text-amber-200'}>{person.allocation?.unit.label ?? 'ohne Platz'}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Quelle: {BOOKING_SOURCE_LABELS[booking.source]} · angelegt {formatShort(booking.createdAt, tz)}.
                {active && <> Plätze setzt du in der <Link href={`${base}/arrange`} className="text-blue-700 dark:text-blue-300 hover:underline">Sitzordnung</Link>.</>}
              </p>
            </div>

            {active && booking.source === 'RSVP' && (
              <div className={card}>
                <h2 className="font-semibold">Bearbeiten</h2>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Diese Gruppe kommt aus einer Zusage in rsvp-app. Name und Begleitungen ändern sich dort und kommen über
                  „Mit rsvp-app abgleichen“ in der <Link href={`${base}/arrange`} className="text-blue-700 dark:text-blue-300 hover:underline">Sitzordnung</Link> hierher.
                </p>
              </div>
            )}

            {active && booking.source !== 'RSVP' && (
              <div className={card}>
                <h2 className="font-semibold">Bearbeiten</h2>
                <ActionForm action={updatePartyAction}>
                  {hidden}
                  <input type="hidden" name="updatedAt" value={booking.updatedAt.toISOString()} />
                  <div>
                    <label htmlFor="party-name" className={labelClass}>Name der Gruppe</label>
                    <input id="party-name" name="name" required maxLength={BOOKING_LIMITS.name} defaultValue={booking.name} className={input} />
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium mb-1">Personen</legend>
                    {attendees.map((person, index) => (
                      <div key={person.id} className="flex items-center gap-2">
                        <label htmlFor={`person-${person.id}`} className="sr-only">Person {index + 1}</label>
                        <input id={`person-${person.id}`} name={`person:${person.id}`} maxLength={ATTENDEE_NAME_MAX} defaultValue={person.name} className={input} />
                        <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                          <input type="checkbox" name={`remove:${person.id}`} aria-label={`${person.name} entfernen`} /> entfernen
                        </label>
                      </div>
                    ))}
                  </fieldset>
                  <div>
                    <label htmlFor="party-added" className={labelClass}>Personen hinzufügen (eine pro Zeile)</label>
                    <textarea id="party-added" name="added" rows={2} className={input} />
                  </div>
                  <SubmitButton>Gruppe speichern</SubmitButton>
                  <p className="text-xs text-gray-600 dark:text-gray-400">Wer entfernt wird, gibt seinen Platz frei.</p>
                </ActionForm>
              </div>
            )}

            <div className={card}>
              <h2 className="font-semibold">Interne Notiz</h2>
              <ActionForm action={saveAdminNote}>
                {hidden}
                <label htmlFor="admin-note" className="sr-only">Interne Notiz</label>
                <textarea id="admin-note" name="adminNote" maxLength={ADMIN_NOTE_MAX} rows={3} defaultValue={booking.adminNote ?? ''} className={input} />
                <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap px-3.5 py-2 text-sm bg-white text-gray-800 hover:bg-gray-50 border border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700">Notiz speichern</button>
                <p className="text-xs text-gray-600 dark:text-gray-400">Nur für Veranstalter*innen sichtbar, z. B. für Essenswünsche.</p>
              </ActionForm>
            </div>
          </div>

          <div className="space-y-4">
            <div className={card}>
              <h2 className="font-semibold">Absagen oder löschen</h2>
              {active && (
                <ActionForm action={cancelBookingAdmin} confirm="Gruppe absagen? Ihre Plätze werden sofort frei, die Gruppe bleibt als abgesagt in der Liste.">
                  {hidden}
                  <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap px-3.5 py-2 text-sm bg-white text-red-700 hover:bg-red-50 border border-red-300 dark:bg-gray-800 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-950">Gruppe hat abgesagt</button>
                </ActionForm>
              )}
              <ActionForm action={deleteBookingAdmin} confirm="Gruppe endgültig löschen? Alle Daten dazu – auch Personen und Verlauf – werden gelöscht.">
                {hidden}
                <button type="submit" className="text-sm text-red-700 dark:text-red-300 hover:underline">Endgültig löschen</button>
                <p className="text-xs text-gray-600 dark:text-gray-400">Z. B. nach einem Tippfehler beim Import oder wenn eine Person die Löschung ihrer Daten verlangt.</p>
              </ActionForm>
            </div>

            <div className={card}>
              <h2 className="font-semibold">Verlauf</h2>
              {auditLog.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">Keine Einträge.</p> : (
                <ul className="text-sm divide-y divide-gray-100 dark:divide-gray-700" data-testid="audit-log">
                  {auditLog.map(entry => {
                    const details = auditDetails(entry, auditContext)
                    return (
                      <li key={entry.id} className="py-1">
                        <span className="text-gray-600 dark:text-gray-400">{formatShort(entry.createdAt, tz)} · {actorText(entry.actor, auditContext)}:</span> {auditText(entry)}
                        {details.length > 0 && <span className="block text-xs text-gray-600 dark:text-gray-400">{details.join('; ')}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
    </div>
  )
}
