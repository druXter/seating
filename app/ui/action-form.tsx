// app/ui/action-form.tsx
'use client'

import { useActionState } from 'react'
import Notice from './notice'

export type ActionFormState = { errors: string[]; message?: string } | null

/**
 * Formular für eine Server Action mit Rückmeldung (Fehler oder Hinweis) - die Felder kommen von der
 * Server-Komponente, die es einbindet. Während die Aktion läuft, ist alles gesperrt (kein doppeltes
 * Absenden). confirm: Rückfrage vor dem Absenden (z.B. Stornieren, Löschen).
 */
export default function ActionForm({
  action, confirm: confirmMessage, className, children
}: {
  action: (previous: ActionFormState, formData: FormData) => Promise<ActionFormState>
  confirm?: string
  className?: string
  children: React.ReactNode
}) {
  const [state, dispatch, pending] = useActionState(action, null)
  return (
    <form
      action={dispatch}
      className={className ?? 'space-y-3'}
      onSubmit={confirmMessage ? event => { if (!confirm(confirmMessage)) event.preventDefault() } : undefined}
    >
      {state && state.errors.length > 0 && (
        <Notice tone="error"><ul className="list-disc list-inside">{state.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>
      )}
      {state?.message && <Notice tone="success">{state.message}</Notice>}
      <fieldset disabled={pending} className="space-y-3 disabled:opacity-60">{children}</fieldset>
    </form>
  )
}
