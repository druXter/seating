// app/admin/page.tsx
import Link from 'next/link'
import { requireUser } from '../lib/auth'
import { canCreateEvents } from '../lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * Einstieg in die Verwaltung. Raumpläne gibt es seit Phase 1, Events folgen mit Phase 2 (siehe
 * docs/KONZEPT.md Abschnitt 12).
 */
export default async function AdminPage() {
  const user = await requireUser('/admin')

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-3">
          <h1 className="text-2xl font-bold">Verwaltung</h1>
          <p className="text-gray-700">Hallo {user.name || user.email}!</p>
          <p className="text-sm text-gray-600">
            {canCreateEvents(user)
              ? 'Hier legst du Raumpläne an – Events und Buchungen folgen.'
              : 'Hier siehst du bald die Events, die für dich freigegeben wurden.'}
          </p>
          <ul className="text-sm list-disc list-inside">
            {canCreateEvents(user) && (
              <li><Link href="/admin/plans" className="text-blue-700 hover:underline">Raumpläne</Link></li>
            )}
            {user.role !== 'MODERATOR' && (
              <li><Link href="/admin/users" className="text-blue-700 hover:underline">Nutzer*innen verwalten</Link></li>
            )}
            <li><Link href="/account" className="text-blue-700 hover:underline">Mein Konto</Link></li>
          </ul>
        </div>
      </div>
    </main>
  )
}
