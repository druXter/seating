// app/b/[bookingId]/[token]/manage-forms.tsx
'use client'

import { useActionState } from 'react'
import { cancelBookingAction, changeBookingAction, type ManageState } from '../../../b/actions'
import { BOOKING_LIMITS } from '../../../lib/events/booking-rules'
import SubmitButton from '../../../ui/submit-button'
import Notice from '../../../ui/notice'

function Errors({ state }: { state: ManageState }) {
  if (!state || state.errors.length === 0) return null
  return <Notice tone="error"><ul className="list-disc list-inside">{state.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>
}

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'

export type ManageValues = {
  bookingId: string; token: string; name: string; phone: string; note: string; partySize: number; unitKey: string; requirePhone: boolean
  tables: { key: string; label: string; capacity: number }[]
}

export function ChangeForm({ values }: { values: ManageValues }) {
  const [state, action, pending] = useActionState(changeBookingAction, null)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="bookingId" value={values.bookingId} />
      <input type="hidden" name="token" value={values.token} />
      <Errors state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="manage-name" className={labelClass}>Name</label>
          <input id="manage-name" name="name" required maxLength={BOOKING_LIMITS.name} defaultValue={values.name} className={input} />
        </div>
        <div>
          <label htmlFor="manage-phone" className={labelClass}>Telefon{values.requirePhone ? '' : ' (optional)'}</label>
          <input id="manage-phone" name="phone" type="tel" required={values.requirePhone} maxLength={BOOKING_LIMITS.phone} defaultValue={values.phone} className={input} />
        </div>
        <div>
          <label htmlFor="manage-party" className={labelClass}>Personen</label>
          <input id="manage-party" name="partySize" type="number" inputMode="numeric" required min={1} defaultValue={values.partySize} className={input} />
        </div>
        <div>
          <label htmlFor="manage-table" className={labelClass}>Tisch</label>
          <select id="manage-table" name="unitKey" defaultValue={values.unitKey} className={input}>
            {values.tables.map(table => (
              <option key={table.key} value={table.key}>
                {table.label} ({table.capacity} Plätze){table.key === values.unitKey ? ' – aktuell' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="manage-note" className={labelClass}>Anmerkung (optional)</label>
        <textarea id="manage-note" name="note" maxLength={BOOKING_LIMITS.note} rows={2} defaultValue={values.note} className={input} />
      </div>
      <SubmitButton disabled={pending}>Änderungen speichern</SubmitButton>
      <p className="text-xs text-gray-600">Zur Auswahl stehen dein Tisch und alle gerade freien Tische. Die E-Mail-Adresse lässt sich nicht ändern.</p>
    </form>
  )
}

export function CancelForm({ bookingId, token }: { bookingId: string; token: string }) {
  const [state, action, pending] = useActionState(cancelBookingAction, null)
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={event => {
        if (!confirm('Buchung wirklich stornieren? Der Tisch wird sofort wieder frei.')) event.preventDefault()
      }}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="token" value={token} />
      <Errors state={state} />
      <button type="submit" disabled={pending} className="text-sm text-red-700 hover:underline disabled:opacity-50">Buchung stornieren</button>
    </form>
  )
}

/** Ein Button für eine Aktion über den Verwaltungslink (Angebot annehmen/ablehnen, austragen). */
export function ManageButtonForm({ action, bookingId, token, label, confirmMessage, primary = false }: {
  action: (previous: ManageState, formData: FormData) => Promise<ManageState>
  bookingId: string
  token: string
  label: string
  confirmMessage?: string
  primary?: boolean
}) {
  const [state, dispatch, pending] = useActionState(action, null)
  return (
    <form
      action={dispatch}
      className="space-y-2"
      onSubmit={confirmMessage ? event => { if (!confirm(confirmMessage)) event.preventDefault() } : undefined}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="token" value={token} />
      <Errors state={state} />
      {primary
        ? <SubmitButton disabled={pending}>{label}</SubmitButton>
        : <button type="submit" disabled={pending} className="text-sm text-red-700 hover:underline disabled:opacity-50">{label}</button>}
    </form>
  )
}
