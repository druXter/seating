// app/ui/footer-link.tsx
'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'

const noSubscription = () => () => {}

/**
 * Link in der Fußzeile (Impressum, Datenschutz). Ist die Seite eingebettet (Gästeansicht als iFrame, siehe
 * next.config.ts), öffnet er in einem neuen Tab - Impressum und Datenschutz sind selbst nicht einbettbar und
 * blieben im iFrame leer.
 */
export default function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const embedded = useSyncExternalStore(noSubscription, () => window.self !== window.top, () => false)
  return embedded ? (
    <a href={href} target="_blank" rel="noopener" className="hover:underline">{children}</a>
  ) : (
    <Link href={href} className="hover:underline">{children}</Link>
  )
}
