// app/admin/plans/new/plan-forms.tsx
'use client'

import { useActionState } from 'react'
import { createPlan, importPlan, type FormState } from '../actions'
import SubmitButton from '../../../ui/submit-button'
import Notice from '../../../ui/notice'

function Errors({ state }: { state: FormState }) {
  if (!state || state.errors.length === 0) return null
  return (
    <Notice tone="error">
      <ul className="list-disc list-inside">
        {state.errors.map((error, index) => <li key={index}>{error}</li>)}
      </ul>
    </Notice>
  )
}

export function CreatePlanForm() {
  const [state, action, pending] = useActionState(createPlan, null)
  return (
    <form action={action} className="space-y-3">
      <Errors state={state} />
      <div>
        <label htmlFor="create-name" className="block text-sm font-medium mb-1">Name</label>
        <input id="create-name" name="name" required maxLength={100} placeholder="z. B. Festsaal" className="w-full border border-gray-300 p-2 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="create-width" className="block text-sm font-medium mb-1">Breite (m)</label>
          <input id="create-width" name="width" type="number" min={1} max={100} step={0.1} defaultValue={20} required className="w-full border border-gray-300 p-2 rounded" />
        </div>
        <div>
          <label htmlFor="create-height" className="block text-sm font-medium mb-1">Länge (m)</label>
          <input id="create-height" name="height" type="number" min={1} max={100} step={0.1} defaultValue={15} required className="w-full border border-gray-300 p-2 rounded" />
        </div>
      </div>
      <SubmitButton disabled={pending}>Leeren Raumplan anlegen</SubmitButton>
    </form>
  )
}

export function ImportPlanForm() {
  const [state, action, pending] = useActionState(importPlan, null)
  return (
    <form action={action} className="space-y-3">
      <Errors state={state} />
      <div>
        <label htmlFor="import-file" className="block text-sm font-medium mb-1">Export-Datei (.json)</label>
        <input id="import-file" name="file" type="file" accept="application/json,.json" required className="w-full text-sm" />
      </div>
      <div>
        <label htmlFor="import-name" className="block text-sm font-medium mb-1">Name (optional)</label>
        <input id="import-name" name="name" maxLength={100} placeholder="sonst aus der Datei" className="w-full border border-gray-300 p-2 rounded" />
      </div>
      <SubmitButton disabled={pending}>Importieren</SubmitButton>
      <p className="text-xs text-gray-600">
        Der Import legt immer einen neuen Raumplan an. Hintergrundbilder sind nicht Teil der Datei.
      </p>
    </form>
  )
}
