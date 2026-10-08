// app/admin/page.tsx
import Link from 'next/link'
import { requireUser } from '../lib/auth'
import { canCreateEvents } from '../lib/permissions'
import InstallHint from '../ui/install-hint'

export const dynamic = 'force-dynamic'

/** Einstieg in die Verwaltung: Events, Raumpläne (nicht für Moderator*innen), Konten. */
export default async function AdminPage() {
  const user = await requireUser('/admin')

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-3">
          <h1 className="text-2xl font-bold">Verwaltung</h1>
          <p className="text-gray-700 dark:text-gray-300">Hallo {user.name || user.email}!</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {canCreateEvents(user)
              ? 'Hier legst du Raumpläne und Events an und verwaltest Buchungen und Sitzordnungen.'
              : 'Hier findest du die Events, die für dich freigegeben wurden.'}
          </p>
          <ul className="text-sm list-disc list-inside">
            <li><Link href="/admin/events" className="text-blue-700 dark:text-blue-300 hover:underline">Events</Link></li>
            {canCreateEvents(user) && (
              <li><Link href="/admin/plans" className="text-blue-700 dark:text-blue-300 hover:underline">Raumpläne</Link></li>
            )}
            {user.role !== 'MODERATOR' && (
              <li><Link href="/admin/users" className="text-blue-700 dark:text-blue-300 hover:underline">Konten verwalten</Link></li>
            )}
            <li><Link href="/account" className="text-blue-700 dark:text-blue-300 hover:underline">Mein Konto</Link></li>
          </ul>
          <InstallHint />
        </div>
      </div>
    </main>
  )
}
