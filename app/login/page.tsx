// app/login/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { sanitizeNextPath } from 'suite-kit'
import { getCurrentUser } from '../lib/auth'
import { loginUser } from '../auth-actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  '1': 'E-Mail oder Passwort ist falsch.',
  locked: 'Zu viele Fehlversuche. Bitte warte etwa 15 Minuten und versuche es dann erneut.'
}

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string; reset?: string }>
}) {
  const { error, next, reset } = await searchParams
  const target = sanitizeNextPath(next, '/admin')

  if (await getCurrentUser()) redirect(target)

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

        <p className="text-xs text-gray-600">
          Zum Buchen brauchst du kein Konto - nur zum Anlegen und Verwalten von Events.
        </p>
      </div>
    </main>
  )
}
