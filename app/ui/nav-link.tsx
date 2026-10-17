// app/ui/nav-link.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Link der Navigation, hervorgehoben, wenn die aktuelle Seite dazugehört (wie in rsvp-app und im Abstimmungstool).
 * `match`: Pfade (genau oder als Präfix mit "/"), `exact`: nur genau der Pfad von `href` (für Reiter wie "Übersicht").
 * `exactOr`: zusätzlich genau dieser Pfad (z. B. /admin für „Events“). Eine Query am `href` zählt beim Vergleich nicht.
 */
export default function NavLink({ href, match, exact = false, exactOr, children, variant = 'top' }: { href: string; match?: string[]; exact?: boolean; exactOr?: string; children: ReactNode; variant?: 'top' | 'tab' }) {
  const pathname = usePathname()
  const path = href.split('?')[0]
  const paths = match ?? [path]
  const active = pathname === exactOr || (exact ? pathname === path : paths.some(p => pathname === p || pathname.startsWith(p + '/')))
  const ref = useRef<HTMLAnchorElement>(null)
  // Reiter auf dem Handy: Der aktive soll in der seitlich scrollenden Leiste sichtbar sein.
  useEffect(() => {
    if (variant === 'tab' && active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [variant, active])
  if (variant === 'tab') {
    return (
      <Link ref={ref} href={href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${active ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}`}>
        {children}
      </Link>
    )
  }
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800'}`}>
      {children}
    </Link>
  )
}
