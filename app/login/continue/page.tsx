// app/login/continue/page.tsx
import { continueTarget } from '../../lib/suite'
import HardRedirect from './hard-redirect'

export const dynamic = 'force-dynamic'

/**
 * Zwischenstation nach einem Login, der mit einem Föderations-Ablauf weitergehen soll (siehe
 * loginUser in app/auth-actions.ts). Erlaubt ausschließlich das Fortsetzen des Anbieter-Endpunkts
 * dieses Tools (continueTarget in app/lib/suite.ts) - jedes andere Ziel fällt auf den Admin-Bereich
 * zurück, damit diese Seite kein Weg für Weiterleitungen an beliebige Adressen wird.
 */
export default async function ContinuePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams

  return (
    <main className="flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm text-gray-900 dark:text-gray-100">
        <HardRedirect to={continueTarget(to)} />
      </div>
    </main>
  )
}
