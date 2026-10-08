// app/account/page.tsx
import { prisma } from '../lib/prisma'
import { requireUser } from '../lib/auth'
import { MIN_PASSWORD_LENGTH } from '../lib/password'
import { ROLE_LABELS } from '../lib/roles'
import { getIdps, idpLabel, issuerLabel } from '../lib/suite'
import { changePassword, unlinkIdentity } from '../auth-actions'
import SubmitButton from '../ui/submit-button'
import Notice from '../ui/notice'
import ConfirmForm from '../ui/confirm-form'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  wrongpassword: 'Das aktuelle Passwort ist falsch.',
  mismatch: 'Die beiden neuen Passwörter stimmen nicht überein.',
  weak: `Das neue Passwort ist zu schwach: mindestens ${MIN_PASSWORD_LENGTH} Zeichen, nicht zu naheliegend und nicht deine E-Mail-Adresse.`,
  locked: 'Zu viele Fehlversuche. Bitte warte etwa 15 Minuten.',
  nopassword: 'Für dieses Konto ist kein Passwort hinterlegt - die Anmeldung läuft über ein anderes Tool.',
  lastlogin: 'Das ist deine einzige Anmeldemöglichkeit - ohne sie kämst du nicht mehr in dein Konto. Die Verknüpfung bleibt.',
  nochain: 'Dieses Konto wird über ein anderes Tool angemeldet und kann deshalb keine Anmeldung für weitere Tools bestätigen.',
  'linked-other': 'Dieses Konto des anderen Tools ist bereits mit einem anderen Konto hier verknüpft.',
  'idp-unreachable': 'Das andere Tool ist gerade nicht erreichbar. Bitte versuche es später erneut.',
  sso: 'Die Verknüpfung mit dem anderen Tool ist fehlgeschlagen. Bitte versuche es erneut.'
}

// Verknüpfte Konten anderer Tools (Föderation über suite-kit, app/api/suite/*): Verknüpfen geht nur aus
// einer bestehenden Sitzung heraus, nie automatisch über die E-Mail-Adresse.
export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; passwordChanged?: string; linked?: string; unlinked?: string }>
}) {
  const user = await requireUser('/account')
  const { error, passwordChanged, linked, unlinked } = await searchParams

  const identities = await prisma.externalIdentity.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } })
  const linkable = getIdps().filter(idp => !identities.some(i => i.issuer === idp.issuer))

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-xl mx-auto space-y-6 text-gray-900 dark:text-gray-100">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-3">
          <h1 className="text-2xl font-bold">Mein Konto</h1>
          {passwordChanged === '1' && <Notice tone="success">Passwort geändert. Andere Geräte wurden abgemeldet.</Notice>}
          {linked === '1' && <Notice tone="success">Konto verknüpft.</Notice>}
          {unlinked === '1' && <Notice tone="success">Verknüpfung entfernt.</Notice>}
          {error && ERRORS[error] && <Notice tone="error">{ERRORS[error]}</Notice>}

          <dl className="text-sm grid grid-cols-[8rem_1fr] gap-y-1">
            <dt className="text-gray-600 dark:text-gray-400">E-Mail</dt>
            <dd>{user.email}</dd>
            {user.name && (<><dt className="text-gray-600 dark:text-gray-400">Name</dt><dd>{user.name}</dd></>)}
            <dt className="text-gray-600 dark:text-gray-400">Rolle</dt>
            <dd>{ROLE_LABELS[user.role]}</dd>
          </dl>
        </div>

        {user.hasPassword && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold">Passwort ändern</h2>
            <form action={changePassword} className="space-y-3">
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium mb-1">Aktuelles Passwort</label>
                <input
                  id="currentPassword" type="password" name="currentPassword" required autoComplete="current-password"
                  className="w-full border border-gray-300 dark:border-gray-600 p-2 rounded"
                />
              </div>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium mb-1">Neues Passwort</label>
                <input
                  id="newPassword" type="password" name="newPassword" required minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password" className="w-full border border-gray-300 dark:border-gray-600 p-2 rounded"
                />
              </div>
              <div>
                <label htmlFor="newPasswordConfirm" className="block text-sm font-medium mb-1">Neues Passwort wiederholen</label>
                <input
                  id="newPasswordConfirm" type="password" name="newPasswordConfirm" required minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password" className="w-full border border-gray-300 dark:border-gray-600 p-2 rounded"
                />
              </div>
              <SubmitButton>Passwort ändern</SubmitButton>
            </form>
          </div>
        )}

        {(identities.length > 0 || linkable.length > 0) && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-3">
            <h2 className="font-bold">Verknüpfte Konten anderer Tools</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Damit meldest du dich hier ohne eigenes Passwort an. Dein Passwort dort erfährt Seating nie.
            </p>

            {identities.map(identity => (
              <div key={identity.id} className="flex items-center justify-between gap-2 text-sm border rounded p-2">
                <span>{issuerLabel(identity.issuer)}</span>
                <ConfirmForm action={unlinkIdentity} message="Verknüpfung wirklich entfernen?">
                  <input type="hidden" name="identityId" value={identity.id} />
                  <button type="submit" className="text-red-700 dark:text-red-300 hover:underline">Entfernen</button>
                </ConfirmForm>
              </div>
            ))}

            {linkable.map(idp => (
              // Bewusst <a> statt <Link>: ein Route Handler, der nicht vorab geladen werden soll.
              <a
                key={idp.issuer}
                href={`/api/suite/login?mode=link&idp=${encodeURIComponent(idp.issuer)}&next=${encodeURIComponent('/account')}`}
                className="block text-center border border-gray-300 dark:border-gray-600 rounded py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                Mit {idpLabel(idp)} verknüpfen
              </a>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
