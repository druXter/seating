// app/page.tsx
import Link from 'next/link'
import { APP_NAME } from './lib/app'

/**
 * Startseite. Buchende kommen über den Link zu ihrem Event (/<slug>, ab Phase 2) und sehen
 * diese Seite normalerweise nie - sie verrät deshalb bewusst keine Liste von Events.
 */
export default function HomePage() {
  return (
    <main className="bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow space-y-4 text-gray-900">
        <h1 className="text-2xl font-bold">{APP_NAME}</h1>
        <p className="text-gray-700">
          Raumpläne, Tischreservierung, Platzwahl und Sitzordnung für Veranstaltungen.
        </p>
        <p className="text-sm text-gray-600">
          Du möchtest einen Platz buchen? Nutze bitte den Link, den du von den Veranstalter*innen bekommen hast.
        </p>
        <p className="text-sm">
          <Link href="/login" className="text-blue-700 hover:underline">Anmelden für Veranstalter*innen</Link>
        </p>
      </div>
    </main>
  )
}
