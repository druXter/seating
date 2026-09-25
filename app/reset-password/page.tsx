// app/reset-password/page.tsx
import Link from 'next/link'
import { prisma } from '../lib/prisma'
import { hashToken } from '../lib/auth'
import { MIN_PASSWORD_LENGTH } from '../lib/password'
import { resetPassword } from '../auth-actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  mismatch: 'Die beiden Passwörter stimmen nicht überein.',
  weak: `Das Passwort ist zu schwach: mindestens ${MIN_PASSWORD_LENGTH} Zeichen, nicht zu naheliegend und nicht deine E-Mail-Adresse.`
}

/**
 * Wird für zwei Fälle genutzt: Passwort-Reset (Link aus "Passwort vergessen") und die
 * Einladung eines neuen Kontos (`invite=1`) - technisch derselbe Einmal-Link, nur der
 * Wortlaut unterscheidet sich.
 */
export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string; error?: string; invite?: string }>
}) {
  const { token, error, invite } = await searchParams

  // Nur zur Anzeige, ob der Link noch gilt - die eigentliche Prüfung wiederholt resetPassword.
  const user = token
    ? await prisma.user.findUnique({
        where: { resetTokenHash: hashToken(token) },
        select: { resetTokenExpiresAt: true }
      })
    : null
  const valid = !!user?.resetTokenExpiresAt && user.resetTokenExpiresAt > new Date()

  const heading = invite === '1' ? 'Passwort festlegen' : 'Neues Passwort'

  return (
    <main className="bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white p-8 rounded-lg shadow space-y-5 text-gray-900">
        <h1 className="text-xl font-bold">{heading}</h1>

        {!valid || error === 'invalid' ? (
          <>
            <Notice tone="error">
              Dieser Link ist ungültig oder abgelaufen. Fordere unter &quot;Passwort vergessen&quot; einen neuen an
              oder bitte die einladende Person um eine neue Einladung.
            </Notice>
            <p className="text-sm">
              <Link href="/forgot-password" className="text-blue-700 hover:underline">Passwort vergessen</Link>
            </p>
          </>
        ) : (
          <form action={resetPassword} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            {error && ERRORS[error] && <Notice tone="error">{ERRORS[error]}</Notice>}
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">Neues Passwort</label>
              <input
                id="password" type="password" name="password" required autoFocus
                minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
                className="w-full border border-gray-300 p-2 rounded"
              />
              <p className="text-xs text-gray-600 mt-1">Mindestens {MIN_PASSWORD_LENGTH} Zeichen - am besten ein ganzer Satz.</p>
            </div>
            <div>
              <label htmlFor="passwordConfirm" className="block text-sm font-medium mb-1">Passwort wiederholen</label>
              <input
                id="passwordConfirm" type="password" name="passwordConfirm" required
                minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
                className="w-full border border-gray-300 p-2 rounded"
              />
            </div>
            <SubmitButton>Passwort speichern</SubmitButton>
          </form>
        )}
      </div>
    </main>
  )
}
