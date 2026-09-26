// app/admin/events/[id]/bookings/[bookingId]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '../../../../../lib/prisma'
import { requireUser } from '../../../../../lib/auth'
import { loadEventOr404 } from '../../../../../lib/events/store'
import { loadAdminBooking, loadAuditContext, tableChoices } from '../../../../../lib/events/admin-booking'
import { ADMIN_NOTE_MAX, BOOKING_SOURCE_LABELS, MAIL_STATUS_LABELS, MAIL_TYPE_LABELS, effectiveStatus } from '../../../../../lib/events/admin-rules'
import { BOOKING_LIMITS } from '../../../../../lib/events/booking-rules'
import { actorText, auditDetails, auditText } from '../../../../../lib/events/audit-text'
import { bookingSecretsConfigured } from '../../../../../lib/booking-tokens'
import { manageUrl } from '../../../../../lib/booking-mail'
import { formatDeadline, formatShort } from '../../../../../lib/timezone'
import {
  cancelBookingAdmin, changeBookingAdmin, confirmBookingAdmin, correctEmailAdmin, deleteBookingAdmin, renewManageLinkAdmin,
  resendVerificationAdmin, saveAdminNote
} from '../../../booking-actions'
import ActionForm from '../../../../../ui/action-form'
import BookingStatusBadge from '../../../../../ui/booking-status-badge'
import CopyableField from '../../../../../ui/copyable-field'
import Notice from '../../../../../ui/notice'
import SubmitButton from '../../../../../ui/submit-button'

export const dynamic = 'force-dynamic'

const DONE: Record<string, string> = {
  created: 'Buchung angelegt.',
  changed: 'Änderungen gespeichert.',
  unchanged: 'Es gab nichts zu ändern.',
  note: 'Interne Notiz gespeichert.',
  cancelled: 'Buchung storniert, der Tisch ist wieder frei.',
  confirmed: 'Buchung bestätigt.',
  resent: 'Neuer Bestätigungslink und Code verschickt.',
  email: 'E-Mail-Adresse korrigiert, die Bestätigungsmail ging an die neue Adresse.',
  link: 'Neuer Verwaltungslink erzeugt – der bisherige gilt nicht mehr.'
}

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'
const card = 'bg-white rounded-lg shadow p-4 space-y-3'

function Checkbox({ name, label, defaultChecked = true }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1" />
      <span>{label}</span>
    </label>
  )
}

/**
 * Eine Buchung aus Sicht der Veranstalter*innen (docs/KONZEPT.md Abschnitt 8): alle Aktionen, der
 * Verlauf (Audit-Log) und die verschickten Mails. Jedes Formular trägt eventId und bookingId; die
 * Server Actions prüfen beides selbst (app/admin/events/booking-actions.ts).
 */
export default async function BookingPage({ params, searchParams }: {
  params: Promise<{ id: string; bookingId: string }>
  searchParams: Promise<{ done?: string; mail?: string }>
}) {
  const { id, bookingId } = await params
  const user = await requireUser(`/admin/events/${id}/bookings/${bookingId}`)
  const event = await loadEventOr404(id, user)
  const booking = await loadAdminBooking(event.id, bookingId)
  if (!booking) notFound()
  const search = await searchParams
  const now = new Date()
  const tz = event.timezone
  const status = effectiveStatus(booking, now)
  const active = status === 'CONFIRMED' || status === 'PENDING'
  const mailable = booking.email !== null

  const [tables, auditLog, mailLog] = await Promise.all([
    active ? tableChoices(event.id, booking.table?.key ?? null, now) : Promise.resolve([]),
    prisma.auditLog.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } }),
    prisma.mailLog.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } })
  ])
  const auditContext = await loadAuditContext(event.id, auditLog.map(e => e.actor))
  const hidden = (
    <>
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="bookingId" value={booking.id} />
    </>
  )
  const base = `/admin/events/${event.id}`
  const link = booking.status === 'CONFIRMED' && bookingSecretsConfigured() ? manageUrl(booking) : null

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-5xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm">
            <Link href={base} className="text-blue-700 hover:underline">{event.title}</Link>
            {' › '}
            <Link href={`${base}/bookings`} className="text-blue-700 hover:underline">Buchungen</Link>
          </p>
          <h1 className="text-2xl font-bold">{booking.name} <BookingStatusBadge status={status} /></h1>
        </div>

        {search.done && DONE[search.done] && <Notice tone={search.done === 'unchanged' ? 'info' : 'success'}>{DONE[search.done]}</Notice>}
        {search.mail === 'failed' && <Notice tone="warning">Die Mail konnte nicht verschickt werden – Einzelheiten unten unter „Mails“.</Notice>}

        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className={card}>
              <h2 className="font-bold">Buchung</h2>
              <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-gray-600">Tisch</dt><dd>{booking.table?.label ?? '–'}</dd>
                <dt className="text-gray-600">Personen</dt><dd>{booking.partySize}</dd>
                <dt className="text-gray-600">E-Mail</dt>
                <dd>
                  {booking.email ?? 'keine'}
                  {booking.email && <span className="block text-xs text-gray-600">{booking.emailVerifiedAt ? `bestätigt am ${formatShort(booking.emailVerifiedAt, tz)}` : 'nicht von der Person bestätigt'}</span>}
                </dd>
                <dt className="text-gray-600">Telefon</dt><dd>{booking.phone ?? '–'}</dd>
                <dt className="text-gray-600">Anmerkung</dt><dd className="whitespace-pre-line">{booking.note ?? '–'}</dd>
                <dt className="text-gray-600">Quelle</dt><dd>{BOOKING_SOURCE_LABELS[booking.source]}</dd>
                <dt className="text-gray-600">Gebucht</dt><dd>{formatShort(booking.createdAt, tz)}</dd>
                {status === 'PENDING' && booking.expiresAt && <><dt className="text-gray-600">Reserviert bis</dt><dd>{formatDeadline(booking.expiresAt, tz, now)}</dd></>}
                {booking.cancelledAt && <><dt className="text-gray-600">Storniert</dt><dd>{formatShort(booking.cancelledAt, tz)}</dd></>}
              </dl>
            </div>

            {active && (
              <div className={card}>
                <h2 className="font-bold">Ändern</h2>
                <ActionForm action={changeBookingAdmin}>
                  {hidden}
                  <input type="hidden" name="updatedAt" value={booking.updatedAt.toISOString()} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="change-name" className={labelClass}>Name</label>
                      <input id="change-name" name="name" required maxLength={BOOKING_LIMITS.name} defaultValue={booking.name} className={input} />
                    </div>
                    <div>
                      <label htmlFor="change-phone" className={labelClass}>Telefon</label>
                      <input id="change-phone" name="phone" type="tel" maxLength={BOOKING_LIMITS.phone} defaultValue={booking.phone ?? ''} className={input} />
                    </div>
                    <div>
                      <label htmlFor="change-party" className={labelClass}>Personen</label>
                      <input id="change-party" name="partySize" type="number" inputMode="numeric" required min={1} defaultValue={booking.partySize} className={input} />
                    </div>
                    <div>
                      <label htmlFor="change-table" className={labelClass}>Tisch</label>
                      <select id="change-table" name="unitKey" defaultValue={booking.table?.key} className={input}>
                        {tables.map(table => (
                          <option key={table.key} value={table.key}>
                            {table.label} ({table.capacity} Plätze){table.key === booking.table?.key ? ' – aktuell' : table.bookable ? '' : ' – nicht buchbar'}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="change-note" className={labelClass}>Anmerkung der Kund*in</label>
                    <textarea id="change-note" name="note" maxLength={BOOKING_LIMITS.note} rows={2} defaultValue={booking.note ?? ''} className={input} />
                  </div>
                  {status === 'CONFIRMED' && mailable && <Checkbox name="notify" label="Kund*in per Mail benachrichtigen (mit Gegenüberstellung alt → neu und neuem Kalendereintrag)" />}
                  <SubmitButton>Änderungen speichern</SubmitButton>
                  <p className="text-xs text-gray-600">
                    Zur Wahl stehen der aktuelle und alle freien Tische, auch nicht buchbare. Die Mindestbelegung gilt hier nicht, die Zahl der Plätze schon.
                    Die E-Mail-Adresse lässt sich {status === 'PENDING' ? 'unten korrigieren' : 'bei bestätigten Buchungen nicht ändern'}.
                  </p>
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
                <p className="text-xs text-gray-600">Nur für Veranstalter*innen sichtbar – nie in Mails oder auf der Seite der Kund*in.</p>
              </ActionForm>
            </div>
          </div>

          <div className="space-y-4">
            {status === 'PENDING' && (
              <div className={card}>
                <h2 className="font-bold">Unbestätigt</h2>
                <ActionForm action={confirmBookingAdmin}>
                  {hidden}
                  {mailable && <Checkbox name="notify" label="Bestätigungsmail mit Kalendereintrag und Verwaltungslink schicken" />}
                  <button type="submit" className="text-sm bg-blue-600 text-white font-bold rounded px-3 py-1 hover:bg-blue-700">Manuell bestätigen</button>
                </ActionForm>
                {mailable && (
                  <ActionForm action={resendVerificationAdmin}>
                    {hidden}
                    <Checkbox name="renew" label={`Frist neu beginnen (${event.pendingTtlMinutes} Minuten ab jetzt)`} />
                    <button type="submit" className="text-sm bg-gray-100 border border-gray-300 rounded px-3 py-1 hover:bg-gray-200">Bestätigungsmail erneut senden</button>
                  </ActionForm>
                )}
                {booking.source !== 'RSVP' && (
                  <ActionForm action={correctEmailAdmin}>
                    {hidden}
                    <div>
                      <label htmlFor="correct-email" className={labelClass}>E-Mail-Adresse korrigieren</label>
                      <input id="correct-email" name="email" type="email" required maxLength={254} defaultValue={booking.email ?? ''} className={input} />
                    </div>
                    <Checkbox name="renew" label="Frist neu beginnen" />
                    <button type="submit" className="text-sm bg-gray-100 border border-gray-300 rounded px-3 py-1 hover:bg-gray-200">Korrigieren und Bestätigungsmail schicken</button>
                    <p className="text-xs text-gray-600">Neuer Link und Code gehen an die neue Adresse. Die alte Adresse bekommt nichts – bei einem Tippfehler gehört sie vermutlich jemand anderem.</p>
                  </ActionForm>
                )}
              </div>
            )}

            {link && (
              <div className={card}>
                <h2 className="font-bold">Verwaltungslink</h2>
                <CopyableField label="Persönlicher Link der Kund*in (nicht weitergeben)" value={link} />
                <ActionForm action={renewManageLinkAdmin} confirm="Neuen Link erzeugen? Der bisherige Link – auch in Kalendereinträgen – funktioniert danach nicht mehr.">
                  {hidden}
                  {mailable && <Checkbox name="notify" label="Neuen Link per Mail schicken" />}
                  <button type="submit" className="text-sm bg-gray-100 border border-gray-300 rounded px-3 py-1 hover:bg-gray-200">Link neu erzeugen</button>
                  <p className="text-xs text-gray-600">Zum Beispiel, wenn der Link in falsche Hände geraten ist.</p>
                </ActionForm>
              </div>
            )}

            <div className={card}>
              <h2 className="font-bold">Stornieren oder löschen</h2>
              {active && (
                <ActionForm action={cancelBookingAdmin} confirm="Buchung stornieren? Der Tisch wird sofort wieder frei.">
                  {hidden}
                  {status === 'CONFIRMED' && mailable && <Checkbox name="notify" label="Kund*in per Mail benachrichtigen (Kalendereintrag wird entfernt)" />}
                  <button type="submit" className="text-sm text-red-700 border border-red-300 rounded px-3 py-1 hover:bg-red-50">Buchung stornieren</button>
                </ActionForm>
              )}
              <ActionForm action={deleteBookingAdmin} confirm="Buchung endgültig löschen? Alle Daten dazu – auch Verlauf und Mailprotokoll – werden gelöscht.">
                {hidden}
                {booking.status === 'CONFIRMED' && mailable && <Checkbox name="notify" label="Vorher Stornomail schicken" />}
                <button type="submit" className="text-sm text-red-700 hover:underline">Endgültig löschen</button>
                <p className="text-xs text-gray-600">Z. B. wenn die Person die Löschung ihrer Daten verlangt. Übrig bleibt nur ein Eintrag ohne Personendaten im Verlauf des Events.</p>
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

            <div className={card}>
              <h2 className="font-bold">Mails</h2>
              {mailLog.length === 0 ? <p className="text-sm text-gray-600">Keine Mails.</p> : (
                <ul className="text-sm divide-y" data-testid="mail-log">
                  {mailLog.map(mail => (
                    <li key={mail.id} className="py-1">
                      <span className="text-gray-600">{formatShort(mail.createdAt, tz)}:</span> {MAIL_TYPE_LABELS[mail.type] ?? mail.type} an {mail.recipient} –{' '}
                      <span className={mail.status === 'failed' ? 'text-red-700' : undefined}>{MAIL_STATUS_LABELS[mail.status] ?? mail.status}</span>
                      {mail.error && <span className="block text-xs text-red-700">{mail.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
