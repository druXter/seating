// app/ui/disclosure.tsx
'use client'

import { useState, type ReactNode } from 'react'

/**
 * Auf- und zuklappbarer Abschnitt, der seinen Zustand behält, wenn die Seite nach einer Server Action
 * neu geladen wird (refresh) - ein <details open={...}> aus der Server-Komponente würde sonst mit
 * den neuen Daten auf- oder zuklappen (z.B. "Gäste hinzufügen" nach der ersten angelegten Gruppe).
 */
export default function Disclosure({ summary, initiallyOpen, className, children }: {
  summary: ReactNode; initiallyOpen: boolean; className?: string; children: ReactNode
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className={className}>
      <summary className="font-bold cursor-pointer">{summary}</summary>
      {children}
    </details>
  )
}
