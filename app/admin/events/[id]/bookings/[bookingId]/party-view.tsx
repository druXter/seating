// app/admin/events/[id]/bookings/[bookingId]/party-view.tsx
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
import Notice from '../../../../../ui/notice'
import SubmitButton from '../../../../../ui/submit-button'

const DONE: Record<string, string> = {
  party: 'Gruppe gespeichert.',
  unchanged: 'Es gab nichts zu ändern.',
  note: 'Interne Notiz gespeichert.',
  cancelled: 'Gruppe abgesagt, ihre Plätze sind wieder frei.'
}

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'
const card = 'bg-white rounded-lg shadow p-4 space-y-3'

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
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-5xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm">
            <Link href={base} className="text-blue-700 hover:underline">{event.title}</Link>
            {' › '}
            <Link href={`${base}/bookings`} className="text-blue-700 hover:underline">Gruppen</Link>
            {' › '}
            <Link href={`${base}/arrange`} className="text-blue-700 hover:underline">Sitzordnung</Link>
          </p>
          <h1 className="text-2xl font-bold">{booking.name} <BookingStatusBadge status={status} /></h1>
        </div>

        {done && DONE[done] && <Notice tone={done === 'unchanged' ? 'info' : 'success'}>{DONE[done]}</Notice>}

        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className={card}>
              <h2 className="font-bold">Personen ({attendees.length})</h2>
              <ul className="text-sm divide-y" data-testid="party-persons">
                {attendees.map(person => (
                  <li key={person.id} className="py-1 flex justify-between gap-2">
                    <span>{person.name}</span>
                    <span className={person.allocation ? 'text-gray-700' : 'text-amber-800'}>{person.allocation?.unit.label ?? 'ohne Platz'}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-gray-600">
                Quelle: {BOOKING_SOURCE_LABELS[booking.source]} · angelegt {formatShort(booking.createdAt, tz)}.
                {active && <> Plätze setzt du in der <Link href={`${base}/arrange`} className="text-blue-700 hover:underline">Sitzordnung</Link>.</>}
              </p>
            </div>

            {active && (
              <div className={card}>
                <h2 className="font-bold">Bearbeiten</h2>
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
                  <p className="text-xs text-gray-600">Wer entfernt wird, gibt seinen Platz frei.</p>
                </ActionForm>
              </div>
            )}

            <div className={card}>
              <h2 className="font-bold">Interne Notiz</h2>
              <ActionForm action={saveAdminNote}>
                {hidden}
                <label htmlFor="admin-note" className="sr-only">Interne Notiz</label>
                <textarea id="admin-note" name="adminNote" maxLength={ADMIN_NOTE_MAX} rows={3} defaultValue={booking.adminNote ?? ''} className={input} />
                <button type="submit" className="text-sm bg-gray-100 border border-gray-300 rounded px-3 py-1 hover:bg-gray-200">Notiz speichern</button>
                <p className="text-xs text-gray-600">Nur für Veranstalter*innen sichtbar, z. B. für Essenswünsche.</p>
              </ActionForm>
            </div>
          </div>

          <div className="space-y-4">
            <div className={card}>
              <h2 className="font-bold">Absagen oder löschen</h2>
              {active && (
                <ActionForm action={cancelBookingAdmin} confirm="Gruppe absagen? Ihre Plätze werden sofort frei, die Gruppe bleibt als abgesagt in der Liste.">
                  {hidden}
                  <button type="submit" className="text-sm text-red-700 border border-red-300 rounded px-3 py-1 hover:bg-red-50">Gruppe hat abgesagt</button>
                </ActionForm>
              )}
              <ActionForm action={deleteBookingAdmin} confirm="Gruppe endgültig löschen? Alle Daten dazu – auch Personen und Verlauf – werden gelöscht.">
                {hidden}
                <button type="submit" className="text-sm text-red-700 hover:underline">Endgültig löschen</button>
                <p className="text-xs text-gray-600">Z. B. nach einem Tippfehler beim Import oder wenn eine Person die Löschung ihrer Daten verlangt.</p>
              </ActionForm>
            </div>

            <div className={card}>
              <h2 className="font-bold">Verlauf</h2>
              {auditLog.length === 0 ? <p className="text-sm text-gray-600">Keine Einträge.</p> : (
                <ul className="text-sm divide-y" data-testid="audit-log">
                  {auditLog.map(entry => {
                    const details = auditDetails(entry, auditContext)
                    return (
                      <li key={entry.id} className="py-1">
                        <span className="text-gray-600">{formatShort(entry.createdAt, tz)} · {actorText(entry.actor, auditContext)}:</span> {auditText(entry)}
                        {details.length > 0 && <span className="block text-xs text-gray-600">{details.join('; ')}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
