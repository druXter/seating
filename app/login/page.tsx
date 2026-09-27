// app/login/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sanitizeNextPath } from 'suite-kit'
import { getCurrentUser } from '../lib/auth'
import { getIdps, idpLabel } from '../lib/suite'
import { loginUser } from '../auth-actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  '1': 'E-Mail oder Passwort ist falsch.',
  locked: 'Zu viele Fehlversuche. Bitte warte etwa 15 Minuten und versuche es dann erneut.',
  sso: 'Die Anmeldung über das andere Tool ist fehlgeschlagen. Bitte versuche es erneut.',
  'idp-unreachable': 'Das andere Tool ist gerade nicht erreichbar. Melde dich mit E-Mail und Passwort an oder versuche es später erneut.',
  'email-taken': 'Zu dieser E-Mail-Adresse gibt es hier bereits ein Konto. Melde dich dort mit dem Passwort an und verknüpfe das andere Konto unter "Mein Konto".',
  'not-linked': 'Dieses Konto ist hier noch nicht bekannt, und eine automatische Anlage ist nicht erlaubt. Bitte lass dich einladen.',
  'linked-other': 'Dieses Konto ist bereits mit einem anderen Konto hier verknüpft.',
  app: 'Diese Anfrage kommt von einer nicht freigegebenen Anwendung und wurde abgelehnt.'
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string; reset?: string }>
}) {
  const { error, next, reset } = await searchParams
  const target = sanitizeNextPath(next, '/admin')

  if (await getCurrentUser()) redirect(target)

  // Nur mit SUITE_IDPS gibt es Buttons für andere Tools - sonst ist Seating ein einzelnes Tool.
  const idps = getIdps()

  return (
    <main className="bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white p-8 rounded-lg shadow space-y-5 text-gray-900">
        <h1 className="text-xl font-bold">Anmelden</h1>

        {reset === '1' && <Notice tone="success">Dein Passwort wurde gesetzt. Du kannst dich jetzt anmelden.</Notice>}
        {error && <Notice tone="error">{ERRORS[error] ?? ERRORS['1']}</Notice>}

        <form action={loginUser} className="space-y-3">
          <input type="hidden" name="next" value={target} />
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
            <input
              id="email" type="email" name="email" required autoFocus autoComplete="username"
              className="w-full border border-gray-300 p-2 rounded"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">Passwort</label>
            <input
              id="password" type="password" name="password" required autoComplete="current-password"
              className="w-full border border-gray-300 p-2 rounded"
            />
          </div>
          <SubmitButton>Anmelden</SubmitButton>
        </form>

        <p className="text-sm">
          <Link href="/forgot-password" className="text-blue-700 hover:underline">Passwort vergessen?</Link>
        </p>

        {idps.length > 0 && (
          <div className="border-t pt-4 space-y-2">
            <p className="text-xs text-gray-600">Oder mit einem Konto aus einem anderen Tool:</p>
            {idps.map(idp => (
              // Bewusst <a> statt <Link>: ein Route Handler, der nicht vorab geladen werden soll.
              <a
                key={idp.issuer}
                href={`/api/suite/login?idp=${encodeURIComponent(idp.issuer)}&next=${encodeURIComponent(target)}`}
                className="block w-full text-center border border-gray-300 rounded py-2 text-sm font-medium hover:bg-gray-50"
              >
                Mit {idpLabel(idp)} anmelden
              </a>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-600">
          Zum Buchen brauchst du kein Konto - nur zum Anlegen und Verwalten von Events.
        </p>
      </div>
    </main>
  )
}
