// app/auth-actions.ts
'use server'

// Übernommen aus dem Abstimmungstool (app/auth-actions.ts), angepasst an die Pfade dieses
// Tools. Ohne die Föderations-Aktionen (unlinkIdentity), die kommen mit Phase 8.

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { sanitizeNextPath } from 'suite-kit'
import type { Role } from '@prisma/client'
import { prisma } from './lib/prisma'
import { baseUrl } from './lib/base-url'
import { formPassword, formString, normalizeEmail } from './lib/form'
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from './lib/password'
import {
  INVITE_LINK_COOKIE, SESSION_COOKIE, cookieOptions, createSession, destroySession, generateToken, hashToken, requireUser
} from './lib/auth'
import {
  clearFailures, clientIp, loginRules, passwordChangeRule, refund, reserve, resetRules
} from './lib/throttle'
import { sendInviteEmail, sendPasswordResetEmail } from './lib/mail'

const INVITE_VALID_MS = 7 * 24 * 60 * 60 * 1000
const RESET_VALID_MS = 60 * 60 * 1000
const ROLES: Role[] = ['ADMIN', 'CREATOR', 'MODERATOR']

/**
 * Meldet mit E-Mail und Passwort an. Sicherheitsverhalten, das hier bewusst so ist:
 * - Drosselung nach IP UND nach Ziel-E-Mail (siehe app/lib/throttle.ts). Der Versuch wird
 *   VOR der Passwortprüfung atomar reserviert - so lässt sich das Limit auch mit vielen
 *   gleichzeitigen Anfragen nicht umgehen, und ein gesperrter Versuch kostet keine Rechenlast.
 * - Bei unbekannter E-Mail (oder Konto ohne Passwort) wird trotzdem eine gleich teure
 *   Prüfung gegen einen Wegwerf-Hash gerechnet und dieselbe Fehlermeldung gezeigt, damit
 *   weder Antwortzeit noch Text verraten, welche Adressen ein Konto haben.
 * - Nach dem Login gilt immer eine NEUE Session (siehe createSession).
 */
export async function loginUser(formData: FormData) {
  const email = formString(formData, 'email', 254).toLowerCase()
  const password = formPassword(formData, 'password')
  const next = sanitizeNextPath(formString(formData, 'next', 1000), '/admin')
  const nextParam = `&next=${encodeURIComponent(next)}`

  const rules = loginRules(await clientIp(), email)
  if (!(await reserve([rules.ip, rules.email]))) {
    redirect(`/login?error=locked${nextParam}`)
  }

  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } })
    : null

  let userId: string | null = null
  if (user?.passwordHash) {
    const check = await verifyPassword(password, user.passwordHash)
    if (check.ok) {
      userId = user.id
      if (check.needsRehash) {
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
      }
    }
  } else {
    await verifyAgainstDummy(password)
  }

  // Fehlversuch: der Versuch ist bereits mitgezählt (reserve), hier bleibt nur die Meldung.
  if (!userId) redirect(`/login?error=1${nextParam}`)

  // Erfolg: Der Versuch wird zurückgegeben (IP-Zähler) bzw. der Zähler zurückgesetzt (E-Mail).
  await refund(rules.ip)
  await clearFailures([rules.email])
  await createSession(userId)

  redirect(next)
}

export async function logoutUser() {
  await destroySession()
  redirect('/')
}

/**
 * Fordert einen Passwort-Reset per Mail an. Antwortet IMMER gleich (Weiterleitung auf
 * ?sent=1), egal ob die Adresse existiert, gedrosselt wurde oder zu einem Admin gehört.
 * Ausgenommen sind Admin-Konten: Wer ein Admin-Postfach übernimmt, soll dadurch nicht
 * automatisch volle Rechte bekommen - dort bleibt ein Reset nur per Server-Zugriff
 * (create-user.js) möglich, gleiche Regel wie in den anderen Tools. Rein föderierte Konten
 * haben kein Passwort und melden sich beim Anbieter an; sie bekommen keinen Reset-Link.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = formString(formData, 'email', 254).toLowerCase()

  if (email) {
    // Jede Anfrage zählt (reserve), auch für unbekannte Adressen - sonst ließe sich über die
    // Drosselung erkennen, welche Adressen ein Konto haben.
    if (await reserve(resetRules(await clientIp(), email))) {
      const user = await prisma.user.findUnique({ where: { email } })
      if (user && user.passwordHash && user.role !== 'ADMIN') {
        const token = generateToken()
        await prisma.user.update({
          where: { id: user.id },
          data: { resetTokenHash: hashToken(token), resetTokenExpiresAt: new Date(Date.now() + RESET_VALID_MS) }
        })
        // Nicht abwarten: Sonst wäre die Antwort bei existierender Adresse merklich langsamer.
        void sendPasswordResetEmail(user.email, `${baseUrl()}/reset-password?token=${token}`)
      }
    }
  }

  redirect('/forgot-password?sent=1')
}

/**
 * Setzt mit einem gültigen Einmal-Link ein Passwort - für Passwort-Reset UND für die
 * Einladung eines neuen Kontos. Macht den Link unbrauchbar und beendet alle bestehenden
 * Sitzungen des Kontos (falls das alte Passwort in fremde Hände geraten war).
 */
export async function resetPassword(formData: FormData) {
  const token = formString(formData, 'token', 200)
  const password = formPassword(formData, 'password')
  const confirm = formPassword(formData, 'passwordConfirm')

  const user = token
    ? await prisma.user.findUnique({ where: { resetTokenHash: hashToken(token) } })
    : null
  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    redirect('/reset-password?error=invalid')
  }

  const back = `/reset-password?token=${encodeURIComponent(token)}`
  if (password !== confirm) redirect(`${back}&error=mismatch`)
  if (validatePassword(password, user.email)) redirect(`${back}&error=weak`)

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), resetTokenHash: null, resetTokenExpiresAt: null }
  })
  await prisma.session.deleteMany({ where: { userId: user.id } })

  redirect('/login?reset=1')
}

/**
 * Ändert das Passwort des eingeloggten Kontos - verlangt das aktuelle Passwort, damit
 * eine gekaperte Sitzung allein nicht reicht, und drosselt dessen Abfrage. Beendet alle
 * ANDEREN Sitzungen, die aktuelle bleibt bestehen.
 */
export async function changePassword(formData: FormData) {
  const user = await requireUser('/account')

  const rule = passwordChangeRule(user.id)
  if (!(await reserve([rule]))) redirect('/account?error=locked')

  const record = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
  if (!record?.passwordHash) redirect('/account?error=nopassword')

  const check = await verifyPassword(formPassword(formData, 'currentPassword'), record.passwordHash)
  if (!check.ok) redirect('/account?error=wrongpassword') // bereits mitgezählt (reserve)

  const newPassword = formPassword(formData, 'newPassword')
  if (newPassword !== formPassword(formData, 'newPasswordConfirm')) redirect('/account?error=mismatch')
  if (validatePassword(newPassword, user.email)) redirect('/account?error=weak')

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } })

  const currentToken = (await cookies()).get(SESSION_COOKIE)?.value
  await prisma.session.deleteMany({
    where: { userId: user.id, ...(currentToken ? { tokenHash: { not: hashToken(currentToken) } } : {}) }
  })
  await clearFailures([rule])

  redirect('/account?passwordChanged=1')
}

/** Legt für ein Konto einen Einladungs-Link an, verschickt ihn (falls SMTP da ist) und zeigt ihn sonst einmalig an. */
async function issueInvite(userId: string, email: string): Promise<'mailed' | 'link'> {
  const token = generateToken()
  await prisma.user.update({
    where: { id: userId },
    data: { resetTokenHash: hashToken(token), resetTokenExpiresAt: new Date(Date.now() + INVITE_VALID_MS) }
  })

  const link = `${baseUrl()}/reset-password?token=${token}&invite=1`
  if (await sendInviteEmail(email, link, INVITE_VALID_MS / (24 * 60 * 60 * 1000))) return 'mailed'

  // Ohne Mailversand bekommt NUR das einladende Konto den Link - einmalig, kurzlebig und
  // nur für /admin/users lesbar, nicht als Adress-Parameter (der landet in Verlauf und Logs).
  const cookieStore = await cookies()
  cookieStore.set(INVITE_LINK_COOKIE, link, { ...cookieOptions(120), path: '/admin/users' })
  return 'link'
}

/**
 * Legt ein neues Konto an und lädt die Person ein - niemand vergibt ein Passwort für
 * andere, die Person legt es selbst über den Einladungs-Link fest. Es gibt keine
 * öffentliche Registrierung. Nur Admins dürfen die Rollen CREATOR/ADMIN vergeben; Creator
 * legen ausschließlich MODERATOR-Konten an (z.B. für das Brautpaar einer Hochzeit), damit
 * nicht jeder Creator beliebig neue eigenständige Creator-Konten erzeugen kann.
 */
export async function createUser(formData: FormData) {
  const actor = await requireUser('/admin/users')
  if (actor.role === 'MODERATOR') redirect('/account')

  const email = normalizeEmail(formString(formData, 'email', 254))
  if (!email) redirect('/admin/users?error=email')

  const requested = formString(formData, 'role', 20) as Role
  const role: Role = actor.role === 'ADMIN' && ROLES.includes(requested) ? requested : 'MODERATOR'

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    redirect('/admin/users?error=exists')
  }

  const user = await prisma.user.create({
    data: { email, name: formString(formData, 'name', 100) || null, role }
  })
  const result = await issueInvite(user.id, user.email)

  revalidatePath('/admin/users')
  redirect(`/admin/users?created=${result}`)
}

/** Erneuert die Einladung eines Kontos, das noch nie angenommen wurde (Link verloren/abgelaufen). Nur Admins. */
export async function resendInvite(formData: FormData) {
  const actor = await requireUser('/admin/users')
  if (actor.role !== 'ADMIN') return

  const target = await prisma.user.findUnique({
    where: { id: formString(formData, 'userId', 50) },
    include: { _count: { select: { identities: true } } }
  })
  // Nur für offene Einladungen: ein Konto mit Passwort oder Fremdanmeldung hat sie nicht nötig,
  // und "Einladung erneuern" darf kein Weg sein, ein bestehendes Konto zu übernehmen.
  if (!target || target.passwordHash || target._count.identities > 0) return

  const result = await issueInvite(target.id, target.email)
  redirect(`/admin/users?created=${result}`)
}

/**
 * Ändert die Rolle eines Kontos. Nur Admins, und nie für ein Admin-Konto (auch nicht das
 * eigene): So kann niemand versehentlich den letzten Admin-Zugang herabstufen. Admin-
 * Rollen ändern bleibt Server-Zugriff (create-user.js) vorbehalten.
 */
export async function updateUserRole(formData: FormData) {
  const actor = await requireUser('/admin/users')
  if (actor.role !== 'ADMIN') return

  const role = formString(formData, 'role', 20) as Role
  if (!ROLES.includes(role)) return

  const target = await prisma.user.findUnique({ where: { id: formString(formData, 'userId', 50) } })
  if (!target || target.role === 'ADMIN') return

  await prisma.user.update({ where: { id: target.id }, data: { role } })
  revalidatePath('/admin/users')
}

/**
 * Löscht ein Konto samt Sitzungen und Verknüpfungen. Nur Admins, und nie ein Admin-Konto.
 * Raumpläne und Events des Kontos gehen dabei an den löschenden Admin über (wie
 * die Abstimmungen im Abstimmungstool) - nichts soll stillschweigend mit einem Konto verschwinden.
 */
export async function deleteUser(formData: FormData) {
  const actor = await requireUser('/admin/users')
  if (actor.role !== 'ADMIN') return

  const target = await prisma.user.findUnique({ where: { id: formString(formData, 'userId', 50) } })
  if (!target || target.role === 'ADMIN') return

  await prisma.$transaction([
    prisma.floorPlan.updateMany({ where: { ownerId: target.id }, data: { ownerId: actor.id } }),
    prisma.event.updateMany({ where: { ownerId: target.id }, data: { ownerId: actor.id } }),
    prisma.user.delete({ where: { id: target.id } })
  ])

  revalidatePath('/admin/users')
}
