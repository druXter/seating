// app/forgot-password/page.tsx
import Link from 'next/link'
import { requestPasswordReset } from '../auth-actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'

export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ sent?: string }>
}) {
  const { sent } = await searchParams

  return (
    <main className="flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white dark:bg-gray-800 p-6 sm:p-8 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-5 text-gray-900 dark:text-gray-100">
        <h1 className="text-xl font-semibold">Passwort vergessen</h1>

        {sent === '1' ? (
          <Notice tone="success">
            Falls zu dieser Adresse ein Konto mit Passwort existiert, haben wir dir einen Link zum
            Zurücksetzen geschickt. Er ist eine Stunde gültig.
          </Notice>
        ) : (
          <form action={requestPasswordReset} className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst.
            </p>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">E-Mail</label>
              <input
                id="email" type="email" name="email" required autoFocus autoComplete="username"
                className="w-full rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900"
              />
            </div>
            <SubmitButton>Link anfordern</SubmitButton>
          </form>
        )}

        <p className="text-xs text-gray-600 dark:text-gray-400">
          Für Konten mit Admin-Rolle gibt es aus Sicherheitsgründen keinen Reset per Mail. Konten, die über ein
          anderes Tool angemeldet werden, setzen ihr Passwort dort zurück.
        </p>
        <p className="text-sm">
          <Link href="/login?local=1" className="text-blue-700 dark:text-blue-300 hover:underline">Zurück zur Anmeldung</Link>
        </p>
      </div>
    </main>
  )
}
