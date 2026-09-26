// app/ui/account-nav.tsx
import Link from 'next/link'
import { getCurrentUser } from '../lib/auth'
import { logoutUser } from '../auth-actions'
import LoginLink from './login-link'

/**
 * Konto-Leiste im Seitenkopf. Nur Anzeige: Sie entscheidet nichts über Zugriffe (das
 * tun die Seiten und Server Actions selbst) - ein Layout wird bei der Navigation nicht
 * neu geprüft und darf deshalb keine Schutzfunktion haben.
 *
 * Buchende haben kein Konto. Auf öffentlichen Eventseiten erscheint die Leiste deshalb nur für
 * eingeloggte Veranstalter*innen (siehe login-link.tsx).
 */
export default async function AccountNav() {
  const user = await getCurrentUser()

  return (
    <nav aria-label="Konto" className="max-w-4xl mx-auto w-full flex items-center justify-end gap-4 px-4 py-3 text-sm text-gray-600">
      {user ? (
        <>
          <Link href="/admin" className="hover:text-gray-900">Verwaltung</Link>
          <Link href="/admin/events" className="hover:text-gray-900">Events</Link>
          {user.role !== 'MODERATOR' && <Link href="/admin/plans" className="hover:text-gray-900">Raumpläne</Link>}
          {user.role !== 'MODERATOR' && <Link href="/admin/users" className="hover:text-gray-900">Nutzer*innen</Link>}
          <Link href="/account" className="hover:text-gray-900">{user.name || user.email}</Link>
          <form action={logoutUser}>
            <button type="submit" className="text-gray-600 hover:text-gray-900">Abmelden</button>
          </form>
        </>
      ) : (
        <LoginLink />
      )}
    </nav>
  )
}
