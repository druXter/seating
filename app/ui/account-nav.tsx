// app/ui/account-nav.tsx
import Link from 'next/link'
import { getCurrentUser } from '../lib/auth'
import { canCreatePlans } from '../lib/permissions'
import { ROLE_LABELS } from '../lib/roles'
import { logoutUser } from '../auth-actions'
import { AppHeader, menuItemClass, menuSeparatorClass } from './kit'
import HeaderGate from './header-gate'

/**
 * Kopfzeile aller Seiten (AppHeader aus suite-kit/ui, wie in allen Tools der Suite): Marke, für angemeldete Konten
 * die Navigation (Events, bei Creator und Admins Raumpläne und Konten) und das Konto-Menü (Mein Konto, Abmelden),
 * sonst nur „Anmelden“. Auf Seiten für Buchende siehe HeaderGate.
 *
 * Nur Anzeige: Sie entscheidet nichts über Zugriffe (das tun die Seiten und Server Actions selbst) - ein Layout wird
 * bei der Navigation nicht neu geprüft und darf deshalb keine Schutzfunktion haben.
 */
export default async function AccountNav() {
  const user = await getCurrentUser()
  return (
    <HeaderGate signedIn={user !== null}>
      <AppHeader
        brand={{ letter: 'S', name: 'Seating', href: user ? '/admin' : '/' }}
        nav={user ? [
          { href: '/admin', label: 'Events', match: ['/admin/events'], exactOr: '/admin' },
          ...(canCreatePlans(user) ? [{ href: '/admin/plans', label: 'Raumpläne' }, { href: '/admin/users', label: 'Konten' }] : [])
        ] : []}
        account={user && {
          name: user.name || user.email,
          detail: <>{user.email}<br />{ROLE_LABELS[user.role]}</>,
          menu: <>
            <Link href="/account" className={menuItemClass}>Mein Konto</Link>
            <form action={logoutUser} className={menuSeparatorClass}>
              <button type="submit" className={menuItemClass}>Abmelden</button>
            </form>
          </>
        }}
        login={{ href: '/login' }}
      />
    </HeaderGate>
  )
}
