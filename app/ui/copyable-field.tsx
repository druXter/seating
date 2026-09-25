// app/ui/copyable-field.tsx
'use client'

import { useId } from 'react'

/**
 * Read-only Eingabefeld, das seinen Inhalt beim Anklicken markiert (zum einfachen
 * Kopieren). Muss eine Client-Komponente sein - Next.js 16 lässt keine
 * Event-Handler mehr an Elemente in Server Components (siehe AGENTS.md).
 * Label und Feld sind per id verknüpft, damit Screenreader die Beschriftung vorlesen.
 */
export default function CopyableField({ label, value }: { label: string; value: string }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-600 mb-1">{label}</label>
      <input
        id={id}
        type="text"
        readOnly
        value={value}
        className="w-full bg-gray-50 border border-gray-200 rounded p-2 text-sm text-gray-700 cursor-pointer"
        onClick={(e) => e.currentTarget.select()}
      />
    </div>
  )
}
