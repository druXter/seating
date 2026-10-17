// app/ui/account-menu.tsx
'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Aufklappmenü der Kopfzeile (ein <details>, ohne JavaScript bedienbar). Mit JavaScript schließt es sich nach einem
 * Seitenwechsel und bei einem Klick daneben - die Kopfzeile liegt im Layout und bleibt sonst samt offenem Menü stehen.
 */
export default function AccountMenu({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    if (ref.current) ref.current.open = false
  }, [pathname])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  return (
    <details ref={ref} className="relative ml-auto">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" aria-label="Konto-Menü">
        {summary}
      </summary>
      <div className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
        {children}
      </div>
    </details>
  )
}
