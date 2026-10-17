// app/page.tsx
import { InstallHint } from './ui/kit'
import Link from 'next/link'
import { APP_NAME } from './lib/app'

/**
 * Startseite. Buchende kommen über den Link zu ihrem Event (/<slug>) und sehen
 * diese Seite normalerweise nie - sie verrät deshalb bewusst keine Liste von Events.
 */
export default function HomePage() {
  return (
    <main className="flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4 text-gray-900 dark:text-gray-100">
        <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
        <p className="text-gray-700 dark:text-gray-300">
          Raumpläne, Tischreservierung, Platzwahl und Sitzordnung für Veranstaltungen.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Du möchtest einen Platz buchen? Nutze bitte den Link, den du von den Veranstalter*innen bekommen hast.
        </p>
        <p className="text-sm">
          <Link href="/login" className="text-blue-700 dark:text-blue-300 hover:underline">Anmelden für Veranstalter*innen</Link>
        </p>
        <InstallHint />
      </div>
    </main>
  )
}
