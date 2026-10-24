// app/admin/plans/new/plan-forms.tsx
'use client'

import { inputClass, labelClass, Notice, SubmitButton } from '../../../ui/kit'
import { useActionState } from 'react'
import { createPlan, importPlan, type FormState } from '../actions'

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
        <label htmlFor="create-name" className={labelClass}>Name</label>
        <input id="create-name" name="name" required maxLength={100} placeholder="z. B. Festsaal" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="create-width" className={labelClass}>Breite (m)</label>
          <input id="create-width" name="width" type="number" min={1} max={100} step={0.1} defaultValue={20} required className={inputClass} />
        </div>
        <div>
          <label htmlFor="create-height" className={labelClass}>Länge (m)</label>
          <input id="create-height" name="height" type="number" min={1} max={100} step={0.1} defaultValue={15} required className={inputClass} />
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
        <label htmlFor="import-file" className={labelClass}>Export-Datei (.json)</label>
        <input id="import-file" name="file" type="file" accept="application/json,.json" required className="w-full text-sm" />
      </div>
      <div>
        <label htmlFor="import-name" className={labelClass}>Name (optional)</label>
        <input id="import-name" name="name" maxLength={100} placeholder="sonst aus der Datei" className={inputClass} />
      </div>
      <SubmitButton disabled={pending}>Importieren</SubmitButton>
      <p className="text-xs text-gray-600 dark:text-gray-400">
        Der Import legt immer einen neuen Raumplan an. Hintergrundbilder sind nicht Teil der Datei.
      </p>
    </form>
  )
}
