// app/ui/copyable-field.tsx
'use client'

import { useId, useState } from 'react'

/**
 * Read-only Eingabefeld, das seinen Inhalt beim Anklicken markiert, mit einem Kopieren-Knopf daneben. Muss eine
 * Client-Komponente sein - Next.js 16 lässt keine Event-Handler mehr an Elemente in Server Components (siehe
 * AGENTS.md). Ohne Zwischenablage (unsicherer Kontext, altes Gerät) bleibt das Markieren.
 */
export default function CopyableField({ label, value }: { label: string; value: string }) {
  const id = useId()
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          readOnly
          value={value}
          className="min-w-0 flex-1 cursor-pointer rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          onClick={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            } catch {
              // Keine Zwischenablage: Das Feld lässt sich weiterhin markieren und von Hand kopieren.
            }
          }}
        >
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
    </div>
  )
}
