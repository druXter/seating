// app/ui/print-button.tsx
'use client'

/** Öffnet den Druckdialog (Client-Komponente, weil ein Event-Handler nötig ist). */
export default function PrintButton({ label = 'Drucken' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="print:hidden bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700 text-sm">
      {label}
    </button>
  )
}
