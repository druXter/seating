// app/[slug]/booking-panel.tsx
'use client'

import { useActionState, useId } from 'react'
import Link from 'next/link'
import { confirmCodeAction, resendAction, type ReserveState } from './booking-actions'
import { BOOKING_LIMITS } from '../lib/events/booking-rules'
import Notice from '../ui/notice'
import SubmitButton from '../ui/submit-button'

/**
 * Buchungsformular für einen gewählten Tisch und - nach dem Reservieren - die Bestätigung per Code.
 * Der Zustand nach dem Reservieren kommt als Rückgabe der Server Action (kein Cookie): Lädt man die
 * Seite neu, geht es über den Link in der Mail weiter.
 */

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'

export function ReserveForm({ eventId, table, partySize, requirePhone, action, pending, errors, onClose }: {
  eventId: string
  table: { key: string; label: string; capacity: number }
  partySize: number | null
  requirePhone: boolean
  action: (formData: FormData) => void
  pending: boolean
  errors: string[]
  onClose: () => void
}) {
  const id = useId()
  return (
    <form action={action} className="space-y-3" aria-labelledby={`${id}-heading`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={`${id}-heading`} className="font-bold text-lg">{table.label} buchen <span className="text-sm font-normal text-gray-600">({table.capacity} Plätze)</span></h2>
        <button type="button" onClick={onClose} className="text-sm text-blue-700 hover:underline">Anderen Tisch wählen</button>
      </div>
      {errors.length > 0 && (
        <Notice tone="error"><ul className="list-disc list-inside">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>
      )}
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="unitKey" value={table.key} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className={labelClass}>Name</label>
          <input id={`${id}-name`} name="name" required maxLength={BOOKING_LIMITS.name} autoComplete="name" className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className={labelClass}>E-Mail</label>
          <input id={`${id}-email`} name="email" type="email" required maxLength={254} autoComplete="email" className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className={labelClass}>Telefon{requirePhone ? '' : ' (optional)'}</label>
          <input id={`${id}-phone`} name="phone" type="tel" required={requirePhone} maxLength={BOOKING_LIMITS.phone} autoComplete="tel" className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-party`} className={labelClass}>Personen</label>
          <input id={`${id}-party`} name="partySize" type="number" inputMode="numeric" required min={1} max={table.capacity} defaultValue={partySize ?? ''} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-party2`} className={labelClass}>Personen (zur Kontrolle wiederholen)</label>
          <input id={`${id}-party2`} name="partySizeConfirm" type="number" inputMode="numeric" required min={1} max={table.capacity} className={input} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-note`} className={labelClass}>Anmerkung (optional)</label>
        <textarea id={`${id}-note`} name="note" maxLength={BOOKING_LIMITS.note} rows={2} className={input} />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="privacy" required className="mt-1" />
        <span>
          Ich habe den <Link href="/datenschutz" target="_blank" className="text-blue-700 underline">Datenschutzhinweis</Link> gelesen.
          Meine Angaben werden nur für diese Buchung verwendet.
        </span>
      </label>
      <SubmitButton disabled={pending}>Tisch reservieren</SubmitButton>
      <p className="text-xs text-gray-600">
        Du bekommst eine Mail mit Link und Code. Erst mit deiner Bestätigung gilt die Buchung – bis dahin halten wir den Tisch kurz für dich frei.
      </p>
    </form>
  )
}

export function PendingPanel({ state }: { state: Extract<ReserveState, { step: 'pending' }> }) {
  const [codeState, codeAction, codePending] = useActionState(confirmCodeAction, null)
  const [resendState, resend, resendPending] = useActionState(resendAction, null)
  const id = useId()

  if (codeState?.kind === 'confirmed') {
    return (
      <div className="space-y-2">
        <Notice tone="success">Deine Buchung ist bestätigt. Wir haben dir eine Mail mit Kalendereintrag und dem Link zu deiner Buchung geschickt.</Notice>
        <p className="text-sm"><a href={codeState.manageUrl} className="text-blue-700 underline">Buchung ansehen oder ändern</a></p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Notice tone="info">
        <strong>{state.tableLabel}</strong> ist bis {state.expiresAtText} für dich reserviert. Wir haben eine Mail an{' '}
        <strong>{state.email}</strong> geschickt – bitte bestätige deine Adresse mit dem Link oder dem Code aus der Mail.
        Ohne Bestätigung wird der Tisch danach wieder frei.
      </Notice>
      <form action={codeAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="bookingId" value={state.bookingId} />
        <div>
          <label htmlFor={`${id}-code`} className={labelClass}>Code aus der Mail</label>
          <input id={`${id}-code`} name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} className="w-36 border border-gray-300 p-2 rounded tracking-widest" />
        </div>
        <button type="submit" disabled={codePending} className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50">Bestätigen</button>
      </form>
      {codeState?.kind === 'error' && <Notice tone="error">{codeState.message}</Notice>}
      <form action={resend} className="text-sm">
        <input type="hidden" name="bookingId" value={state.bookingId} />
        <button type="submit" disabled={resendPending} className="text-blue-700 hover:underline disabled:opacity-50">Keine Mail bekommen? Erneut senden</button>
        <span className="block text-xs text-gray-600">Ein neuer Code macht den alten ungültig. Die Reservierung verlängert sich dadurch nicht.</span>
      </form>
      {resendState?.sent === true && <Notice tone="success">Falls die Reservierung noch besteht, ist eine neue Mail unterwegs.</Notice>}
      {resendState?.sent === false && <Notice tone="error">{resendState.message}</Notice>}
    </div>
  )
}
