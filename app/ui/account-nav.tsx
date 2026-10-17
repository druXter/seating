// app/ui/account-nav.tsx
import Link from 'next/link'
import { getCurrentUser } from '../lib/auth'
import { canCreatePlans } from '../lib/permissions'
import { ROLE_LABELS } from '../lib/roles'
import { logoutUser } from '../auth-actions'
import NavLink from './nav-link'
import AccountMenu from './account-menu'
import HeaderGate from './header-gate'

/**
 * Kopfzeile aller Seiten (docs/KONZEPT-OBERFLAECHE.md), aufgebaut wie in rsvp-app, Abstimmungstool, Schichten und
 * Zeitplan: Marke, für angemeldete Konten die Navigation (Events, bei Creator und Admins Raumpläne und Konten) und das
 * Konto-Menü (Mein Konto, Abmelden), sonst nur „Anmelden“. Beim Drucken ausgeblendet, auf Seiten für Buchende siehe
 * HeaderGate.
 *
 * Nur Anzeige: Sie entscheidet nichts über Zugriffe (das tun die Seiten und Server Actions selbst) - ein Layout wird
 * bei der Navigation nicht neu geprüft und darf deshalb keine Schutzfunktion haben.
 */
export default async function AccountNav() {
  const user = await getCurrentUser()
  const menuItem = 'block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'

  return (
    <HeaderGate signedIn={user !== null}>
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <Link href={user ? '/admin' : '/'} aria-label="Seating – Start" className="mr-1 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-sm text-white">S</span>
            <span aria-hidden className="hidden sm:inline">Seating</span>
          </Link>
          {user ? (
            <>
              <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Hauptnavigation">
                <NavLink href="/admin" match={['/admin/events']} exactOr="/admin">Events</NavLink>
                {canCreatePlans(user) && <NavLink href="/admin/plans">Raumpläne</NavLink>}
                {canCreatePlans(user) && <NavLink href="/admin/users">Konten</NavLink>}
              </nav>
              <AccountMenu
                summary={<>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-200">{(user.name || user.email).slice(0, 1)}</span>
                  <span className="hidden max-w-48 truncate md:inline">{user.name || user.email}</span>
                  <span aria-hidden className="text-gray-400">▾</span>
                </>}
              >
                <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 break-all">{user.email}<br />{ROLE_LABELS[user.role]}</p>
                <Link href="/account" className={menuItem}>Mein Konto</Link>
                <form action={logoutUser} className="border-t border-gray-100 pt-1 dark:border-gray-700">
                  <button type="submit" className={menuItem}>Abmelden</button>
                </form>
              </AccountMenu>
            </>
          ) : (
            <Link href="/login" className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100">Anmelden</Link>
          )}
        </div>
      </header>
    </HeaderGate>
  )
}
