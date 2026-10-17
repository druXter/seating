// app/ui/print-button.tsx
'use client'

import { buttonClass } from './kit'

/** Öffnet den Druckdialog (Client-Komponente, weil ein Event-Handler nötig ist). */
export default function PrintButton({ label = 'Drucken' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`print:hidden ${buttonClass('primary')}`}>
      {label}
    </button>
  )
}
