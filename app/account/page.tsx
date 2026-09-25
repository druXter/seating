// app/account/page.tsx
import { requireUser } from '../lib/auth'
import { MIN_PASSWORD_LENGTH } from '../lib/password'
import { ROLE_LABELS } from '../lib/roles'
import { changePassword } from '../auth-actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  wrongpassword: 'Das aktuelle Passwort ist falsch.',
  mismatch: 'Die beiden neuen Passwörter stimmen nicht überein.',
  weak: `Das neue Passwort ist zu schwach: mindestens ${MIN_PASSWORD_LENGTH} Zeichen, nicht zu naheliegend und nicht deine E-Mail-Adresse.`,
  locked: 'Zu viele Fehlversuche. Bitte warte etwa 15 Minuten.',
  nopassword: 'Für dieses Konto ist kein Passwort hinterlegt - die Anmeldung läuft über ein anderes Tool.'
}

// Verknüpfte Konten anderer Tools (Föderation über suite-kit) kommen mit Phase 8 hierher.
export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string }>
}) {
  const user = await requireUser('/account')
  const { error, passwordChanged } = await searchParams

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-6 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-3">
          <h1 className="text-2xl font-bold">Mein Konto</h1>
          {passwordChanged === '1' && <Notice tone="success">Passwort geändert. Andere Geräte wurden abgemeldet.</Notice>}
          {error && ERRORS[error] && <Notice tone="error">{ERRORS[error]}</Notice>}

          <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-gray-600">E-Mail</dt>
            <dd>{user.email}</dd>
            {user.name && (<><dt className="text-gray-600">Name</dt><dd>{user.name}</dd></>)}
            <dt className="text-gray-600">Rolle</dt>
            <dd>{ROLE_LABELS[user.role]}</dd>
          </dl>
        </div>

        {user.hasPassword && (
          <div className="bg-white p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold">Passwort ändern</h2>
            <form action={changePassword} className="space-y-3">
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium mb-1">Aktuelles Passwort</label>
                <input
                  id="currentPassword" type="password" name="currentPassword" required autoComplete="current-password"
                  className="w-full border border-gray-300 p-2 rounded"
                />
              </div>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium mb-1">Neues Passwort</label>
                <input
                  id="newPassword" type="password" name="newPassword" required minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password" className="w-full border border-gray-300 p-2 rounded"
                />
              </div>
              <div>
                <label htmlFor="newPasswordConfirm" className="block text-sm font-medium mb-1">Neues Passwort wiederholen</label>
                <input
                  id="newPasswordConfirm" type="password" name="newPasswordConfirm" required minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password" className="w-full border border-gray-300 p-2 rounded"
                />
              </div>
              <SubmitButton>Passwort ändern</SubmitButton>
            </form>
          </div>
        )}
      </div>
    </main>
  )
}
