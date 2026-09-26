// app/verify/[bookingId]/[token]/confirm-button.tsx
'use client'

import { useActionState } from 'react'
import { confirmLinkAction } from '../../actions'
import SubmitButton from '../../../ui/submit-button'
import Notice from '../../../ui/notice'

export default function ConfirmButton({ bookingId, token }: { bookingId: string; token: string }) {
  const [state, action, pending] = useActionState(confirmLinkAction, null)
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="token" value={token} />
      {state && <Notice tone="error">{state.message}</Notice>}
      <SubmitButton disabled={pending}>Buchung bestätigen</SubmitButton>
    </form>
  )
}
