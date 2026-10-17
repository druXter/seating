// app/ui/disclosure.tsx
'use client'

import { useState, type ReactNode } from 'react'

/**
 * Ein <details>, das seinen Zustand selbst hält: `defaultOpen` gilt nur beim ersten Anzeigen. Ein gesteuertes `open`
 * klappte sonst zu, sobald sich die Bedingung nach dem Speichern ändert (z. B. „offen, solange es keine Helfer*innen
 * gibt“) - und mit ihm die Rückmeldung des Formulars darin.
 */
export default function Disclosure({ defaultOpen = false, className, id, testId, children }: { defaultOpen?: boolean; className?: string; id?: string; testId?: string; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details id={id} open={open} onToggle={event => setOpen(event.currentTarget.open)} className={className} data-testid={testId}>
      {children}
    </details>
  )
}
