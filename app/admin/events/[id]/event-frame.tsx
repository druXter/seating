// app/admin/events/[id]/event-frame.tsx
'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Seiten mit großem Plan (Editor, Sitzordnung) bekommen mehr Breite als die übrigen Seiten eines Events. */
const WIDE = /^\/admin\/events\/[^/]+\/(plan|arrange)$/

/** Inhaltsbereich der Seiten eines Events (wie Main aus app/ui/kit.tsx, aber je nach Seite breiter). */
export default function EventFrame({ children }: { children: ReactNode }) {
  const wide = WIDE.test(usePathname())
  return <main className={`mx-auto w-full px-4 py-6 sm:py-8 print:max-w-none print:p-0 ${wide ? 'max-w-7xl' : 'max-w-5xl'} text-gray-900 dark:text-gray-100`}>{children}</main>
}
