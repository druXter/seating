// app/admin/users/page.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { INVITE_LINK_COOKIE, requireUser } from '../../lib/auth'
import { ROLE_LABELS } from '../../lib/roles'
import { createUser, deleteUser, resendInvite, updateUserRole } from '../../auth-actions'
import { isMailConfigured } from '../../lib/mail'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'
import ConfirmForm from '../../ui/confirm-form'
import CopyableField from '../../ui/copyable-field'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  email: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  exists: 'Zu dieser E-Mail-Adresse gibt es bereits ein Konto.'
}

// Übernommen aus dem Abstimmungstool (app/nutzer/page.tsx). Die Anzahl der Events pro Konto
// kommt mit Phase 2 dazu.
export default async function UsersPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; created?: string }>
}) {
  const actor = await requireUser('/admin/users')
  if (actor.role === 'MODERATOR') redirect('/account')
  const { error, created } = await searchParams

  const isAdmin = actor.role === 'ADMIN'
  const inviteLink = created === 'link' ? (await cookies()).get(INVITE_LINK_COOKIE)?.value : undefined

  // Die Kontoliste sehen nur Admins. Creator legen hier höchstens Moderator-Konten an.
  const users = isAdmin
    ? await prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, email: true, name: true, role: true, passwordHash: true,
          _count: { select: { identities: true } }
        }
      })
    : []

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h1 className="text-2xl font-bold">{isAdmin ? 'Nutzer*innen' : 'Moderator*in anlegen'}</h1>

          {created === 'mailed' && <Notice tone="success">Konto angelegt. Die Einladung wurde per E-Mail verschickt.</Notice>}
          {created === 'link' && (
            <Notice tone="warning">
              Konto angelegt. Es ist kein Mailversand eingerichtet - gib diesen Einladungslink selbst an die Person weiter.
              Er ist 7 Tage gültig, nur einmal nutzbar und wird hier nur kurz angezeigt.
              {inviteLink && <div className="mt-2"><CopyableField label="Einladungslink" value={inviteLink} /></div>}
            </Notice>
          )}
          {error && ERRORS[error] && <Notice tone="error">{ERRORS[error]}</Notice>}

          <form action={createUser} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">E-Mail</label>
              <input id="email" type="email" name="email" required maxLength={254} className="w-full border border-gray-300 p-2 rounded" />
            </div>
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">Name (optional)</label>
              <input id="name" type="text" name="name" maxLength={100} className="w-full border border-gray-300 p-2 rounded" />
            </div>
            {isAdmin && (
              <div>
                <label htmlFor="role" className="block text-sm font-medium mb-1">Rolle</label>
                <select id="role" name="role" defaultValue="CREATOR" className="w-full border border-gray-300 p-2 rounded bg-white">
                  <option value="CREATOR">Creator (legt eigene Events und Raumpläne an)</option>
                  <option value="MODERATOR">Moderator*in (nur freigegebene Events)</option>
                  <option value="ADMIN">Administrator*in</option>
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <SubmitButton>Konto anlegen und einladen</SubmitButton>
              <p className="text-xs text-gray-600 mt-2">
                Die Person legt ihr Passwort selbst über den Einladungslink fest
                {isMailConfigured() ? ' - er geht direkt per E-Mail raus.' : ' - ohne Mailversand bekommst du den Link zum Weitergeben angezeigt.'}
              </p>
            </div>
          </form>
        </div>

        {isAdmin && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="font-bold mb-3">Alle Konten ({users.length})</h2>
            <ul className="divide-y text-sm">
              {users.map(u => {
                const pending = !u.passwordHash && u._count.identities === 0
                const protectedAccount = u.role === 'ADMIN'
                return (
                  <li key={u.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="grow min-w-0">
                      <div className="font-medium truncate">{u.name ? `${u.name} · ` : ''}{u.email}</div>
                      <div className="text-xs text-gray-600">
                        {ROLE_LABELS[u.role]}
                        {' · '}
                        {pending ? 'Einladung offen' : u.passwordHash ? 'Passwort' : 'Anmeldung über anderes Tool'}
                      </div>
                    </div>

                    {!protectedAccount && (
                      <>
                        <form action={updateUserRole} className="flex items-center gap-1">
                          <input type="hidden" name="userId" value={u.id} />
                          <select name="role" defaultValue={u.role} aria-label={`Rolle von ${u.email}`} className="border border-gray-300 rounded p-1 text-xs bg-white">
                            <option value="CREATOR">Creator</option>
                            <option value="MODERATOR">Moderator*in</option>
                            <option value="ADMIN">Administrator*in</option>
                          </select>
                          <button type="submit" className="text-xs text-blue-700 hover:underline">Ändern</button>
                        </form>

                        {pending && (
                          <form action={resendInvite}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button type="submit" className="text-xs text-blue-700 hover:underline">Einladung erneuern</button>
                          </form>
                        )}

                        <ConfirmForm action={deleteUser} message={`Konto ${u.email} löschen?`}>
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" className="text-xs text-red-700 hover:underline">Löschen</button>
                        </ConfirmForm>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="text-xs text-gray-600 mt-3">
              Administrator-Konten lassen sich hier nicht ändern oder löschen (Schutz vor versehentlichem Aussperren) -
              das geht nur per <code>create-user.js</code> auf dem Server.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
