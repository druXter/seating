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
    <main className="bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full bg-white p-8 rounded-lg shadow space-y-5 text-gray-900">
        <h1 className="text-xl font-bold">Passwort vergessen</h1>

        {sent === '1' ? (
          <Notice tone="success">
            Falls zu dieser Adresse ein Konto mit Passwort existiert, haben wir dir einen Link zum
            Zurücksetzen geschickt. Er ist eine Stunde gültig.
          </Notice>
        ) : (
          <form action={requestPasswordReset} className="space-y-3">
            <p className="text-sm text-gray-600">
              Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst.
            </p>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
              <input
                id="email" type="email" name="email" required autoFocus autoComplete="username"
                className="w-full border border-gray-300 p-2 rounded"
              />
            </div>
            <SubmitButton>Link anfordern</SubmitButton>
          </form>
        )}

        <p className="text-xs text-gray-600">
          Für Administrator-Konten gibt es aus Sicherheitsgründen keinen Reset per Mail. Konten, die über ein
          anderes Tool angemeldet werden, setzen ihr Passwort dort zurück.
        </p>
        <p className="text-sm">
          <Link href="/login" className="text-blue-700 hover:underline">Zurück zur Anmeldung</Link>
        </p>
      </div>
    </main>
  )
}
