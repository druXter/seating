// app/admin/plans/[id]/editor/fields.tsx
'use client'

import { useId, type KeyboardEvent } from 'react'

/**
 * Eingabefelder des Eigenschaften-Panels. Sie sind bewusst ungesteuert und übernehmen den Wert
 * erst beim Verlassen des Felds oder mit Enter - sonst erzeugte jeder Tastendruck ("1", "15",
 * "150") einen eigenen Schritt im Rückgängig-Verlauf. Ändert sich der Wert von außen (Ziehen,
 * Rückgängig), setzt der Aufrufer das Feld über `key` neu auf.
 */

const inputClass = 'w-full border border-gray-300 rounded px-2 py-1 text-sm'

function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') event.currentTarget.blur()
}

export function NumberField({ label, value, min, max, step = 1, onCommit, suffix }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string
  onCommit: (value: number) => void
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-700 mb-0.5">{label}{suffix ? ` (${suffix})` : ''}</label>
      <input
        id={id} type="number" defaultValue={value} min={min} max={max} step={step} className={inputClass}
        onKeyDown={commitOnEnter}
        onBlur={(event) => {
          const parsed = Number(event.currentTarget.value.replace(',', '.'))
          if (!Number.isFinite(parsed)) {
            event.currentTarget.value = String(value)
            return
          }
          const clamped = Math.min(max, Math.max(min, step >= 1 ? Math.round(parsed) : parsed))
          event.currentTarget.value = String(clamped)
          if (clamped !== value) onCommit(clamped)
        }}
      />
    </div>
  )
}

export function TextField({ label, value, maxLength = 100, placeholder, onCommit }: {
  label: string; value: string; maxLength?: number; placeholder?: string; onCommit: (value: string) => void
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-700 mb-0.5">{label}</label>
      <input
        id={id} type="text" defaultValue={value} maxLength={maxLength} placeholder={placeholder} className={inputClass}
        onKeyDown={commitOnEnter}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim()
          if (next !== value) onCommit(next)
        }}
      />
    </div>
  )
}

export function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-700 mb-0.5">{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value as T)} className={`${inputClass} bg-white`}>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    </div>
  )
}

export function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      {label}
    </label>
  )
}
