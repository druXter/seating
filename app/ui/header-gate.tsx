// app/ui/header-gate.tsx
'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { RESERVED_SLUGS } from '../lib/slugs'

/** Seiten für Buchende ohne Konto: Verwaltungslink (/b/...), Bestätigung (/verify/...), Platzwahl über rsvp-app (/rsvp/...). */
const GUEST_PREFIXES = new Set(['b', 'verify', 'rsvp'])

/**
 * Blendet die Kopfzeile auf Seiten für Buchende aus, solange niemand angemeldet ist: Eventseite (/<slug>),
 * Verwaltungs- und Bestätigungslinks, Platzwahl über rsvp-app. Buchende haben kein Konto - Marke und „Anmelden“
 * würden dort nur verwirren (und in eingebetteten Seiten stören). Angemeldete Veranstalter*innen behalten sie.
 */
export default function HeaderGate({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const guestPage = segments.length > 0 && (!RESERVED_SLUGS.has(segments[0]) || GUEST_PREFIXES.has(segments[0]))
  if (guestPage && !signedIn) return null
  return <>{children}</>
}
