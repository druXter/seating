// app/admin/events/[id]/bookings/new/page.tsx
import Link from 'next/link'
import { requireUser } from '../../../../../lib/auth'
import { loadEventOr404 } from '../../../../../lib/events/store'
import { tableChoices } from '../../../../../lib/events/admin-booking'
import { ADMIN_NOTE_MAX } from '../../../../../lib/events/admin-rules'
import { BOOKING_LIMITS } from '../../../../../lib/events/booking-rules'
import { createBookingAdmin } from '../../../booking-actions'
import ActionForm from '../../../../../ui/action-form'
import Notice from '../../../../../ui/notice'
import SubmitButton from '../../../../../ui/submit-button'

export const dynamic = 'force-dynamic'

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'

/**
 * Buchung von Hand anlegen (source ADMIN), z.B. eine telefonische Reservierung. Ohne E-Mail-Adresse
 * ist sie direkt bestätigt und bekommt keine Mails; mit Adresse wahlweise direkt bestätigt oder mit
 * Bestätigung per Mail wie online. ?table=<key>: vorausgewählt (Klick auf einen freien Tisch im Plan).
 */
export default async function NewBookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ table?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/bookings/new`)
  const event = await loadEventOr404(id, user)
  const { table } = await searchParams
  const tables = await tableChoices(event.id, null)
  const preselected = tables.some(t => t.key === table) ? table : undefined

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-4 text-gray-900">
        <div className="space-y-1">
          <p className="text-sm">
            <Link href={`/admin/events/${event.id}`} className="text-blue-700 hover:underline">{event.title}</Link>
            {' › '}
            <Link href={`/admin/events/${event.id}/bookings`} className="text-blue-700 hover:underline">Buchungen</Link>
          </p>
          <h1 className="text-2xl font-bold">Buchung anlegen</h1>
        </div>

        {tables.length === 0 ? (
          <Notice tone="warning">Gerade ist kein Tisch frei.</Notice>
        ) : (
          <div className="bg-white rounded-lg shadow p-4">
            <ActionForm action={createBookingAdmin}>
              <input type="hidden" name="eventId" value={event.id} />
              <div>
                <label htmlFor="new-table" className={labelClass}>Tisch</label>
                <select id="new-table" name="unitKey" defaultValue={preselected} className={input}>
                  {tables.map(t => <option key={t.key} value={t.key}>{t.label} ({t.capacity} Plätze){t.bookable ? '' : ' – nicht buchbar'}</option>)}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="new-name" className={labelClass}>Name</label>
                  <input id="new-name" name="name" required maxLength={BOOKING_LIMITS.name} className={input} />
                </div>
                <div>
                  <label htmlFor="new-party" className={labelClass}>Personen</label>
                  <input id="new-party" name="partySize" type="number" inputMode="numeric" required min={1} className={input} />
                </div>
                <div>
                  <label htmlFor="new-email" className={labelClass}>E-Mail (optional)</label>
                  <input id="new-email" name="email" type="email" maxLength={254} className={input} />
                </div>
                <div>
                  <label htmlFor="new-phone" className={labelClass}>Telefon (optional)</label>
                  <input id="new-phone" name="phone" type="tel" maxLength={BOOKING_LIMITS.phone} className={input} />
                </div>
              </div>
              <div>
                <label htmlFor="new-note" className={labelClass}>Anmerkung der Kund*in (optional)</label>
                <textarea id="new-note" name="note" maxLength={BOOKING_LIMITS.note} rows={2} className={input} />
              </div>
              <div>
                <label htmlFor="new-admin-note" className={labelClass}>Interne Notiz (optional)</label>
                <textarea id="new-admin-note" name="adminNote" maxLength={ADMIN_NOTE_MAX} rows={2} className={input} />
              </div>
              <fieldset className="space-y-1 text-sm">
                <legend className="font-medium mb-1">Bestätigung</legend>
                <label className="flex items-start gap-2">
                  <input type="radio" name="confirm" value="direct" defaultChecked className="mt-1" />
                  <span>Direkt bestätigt</span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="confirm" value="verify" className="mt-1" />
                  <span>Bestätigung per Mail anfordern (wie bei einer Online-Buchung, Frist {event.pendingTtlMinutes} Minuten)</span>
                </label>
              </fieldset>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="notify" defaultChecked className="mt-1" />
                <span>Bei direkter Bestätigung: Bestätigungsmail mit Kalendereintrag und Verwaltungslink schicken (nur mit E-Mail-Adresse)</span>
              </label>
              <SubmitButton>Buchung anlegen</SubmitButton>
              <p className="text-xs text-gray-600">
                Ohne E-Mail-Adresse bekommt die Person keine Mails und keinen Verwaltungslink – Änderungen laufen dann über euch.
                {event.oneBookingPerEmail && ' Pro E-Mail-Adresse ist nur eine aktive Buchung möglich (abschaltbar in den Einstellungen).'}
              </p>
            </ActionForm>
          </div>
        )}
      </div>
    </main>
  )
}
