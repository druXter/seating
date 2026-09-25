// app/lib/auth.ts
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHash, randomBytes } from 'node:crypto'
import type { Role } from '@prisma/client'
import { prisma } from './prisma'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Das `__Host-`-Präfix erzwingt Secure, Path=/ und KEIN Domain-Attribut: Der Browser
 * akzeptiert das Cookie dann nur von genau diesem Host. Die Tools der Suite laufen auf
 * Subdomains derselben Domain - ohne das Präfix könnte eine andere Subdomain ein
 * Session-Cookie für diese hier setzen oder überschreiben (Cookie-Tossing). In der
 * Entwicklung über http://localhost ist das Präfix nicht nutzbar, dort gilt der einfache Name.
 */
export const SESSION_COOKIE = isProduction ? '__Host-session' : 'session'
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30 // 30 Tage

/** Kurzzeit-Cookie, das einen frisch erzeugten Einladungslink genau einmal auf /admin/users anzeigt (siehe app/auth-actions.ts). */
export const INVITE_LINK_COOKIE = 'invite_link'

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds
  }
}

/** Sitzungs- und Einmal-Links werden nur als SHA-256-Hash gespeichert (siehe schema.prisma). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Was Seiten und Aktionen über das eingeloggte Konto erfahren - bewusst ein schmales
 * Objekt statt des ganzen User-Datensatzes (kein passwordHash, keine Reset-Felder),
 * damit ein Versehen nie sensible Felder an eine Seite oder den Client durchreicht.
 */
export type CurrentUser = {
  id: string
  email: string
  name: string | null
  role: Role
  hasPassword: boolean
}

/**
 * Legt eine neue Sitzung in der Datenbank an und gibt deren Token zurück. Eine bereits
 * vorhandene Sitzung dieses Browsers wird dabei verworfen (Schutz vor Session-Fixation:
 * nach dem Login gilt nie ein Token, den der Browser schon vorher hatte). Abgelaufene
 * Sitzungen werden bei dieser Gelegenheit gleich mit aufgeräumt. Das Cookie setzt der
 * Aufrufer - Server Actions über createSession, Route Handler direkt an ihrer Response.
 */
export async function issueSession(userId: string): Promise<string> {
  const previous = (await cookies()).get(SESSION_COOKIE)?.value
  if (previous) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(previous) } })
  }
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  // Veraltete Drossel-Zähler (siehe app/lib/throttle.ts) gleich mit entfernen: Sie sind nach dem
  // Zeitfenster wertlos, sollen aber auch dann nicht liegen bleiben, wenn lange niemand mehr scheitert.
  await prisma.loginThrottle.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })

  const token = generateToken()
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + SESSION_DURATION_MS) }
  })
  // Hält lastLoginAt aktuell, damit die automatische Löschung inaktiver Konten nur wirklich
  // ungenutzte trifft (siehe app/api/cron/cleanup/route.ts).
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
  return token
}

/** Für Server Actions: neue Sitzung anlegen UND das Cookie setzen. */
export async function createSession(userId: string): Promise<void> {
  const token = await issueSession(userId)
  ;(await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_DURATION_MS / 1000))
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } })
  }
  cookieStore.set(SESSION_COOKIE, '', { ...cookieOptions(0), maxAge: 0 })
}

/**
 * Liest das eingeloggte Konto anhand des Cookies aus der Datenbank (das Cookie selbst
 * enthält nur einen zufälligen Token). Pro Anfrage gecacht, damit mehrere Aufrufe in
 * einem Render nur eine Abfrage kosten.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, role: true, passwordHash: true } }
    }
  })
  if (!session || session.expiresAt < new Date()) return null

  const { passwordHash, ...user } = session.user
  return { ...user, hasPassword: passwordHash !== null }
})

/**
 * Für Seiten UND Server Actions: leitet auf die Anmeldung um, wenn niemand eingeloggt
 * ist, und kehrt danach an `next` zurück. Jede Server Action muss selbst prüfen - eine
 * Seitenprüfung schützt Actions nicht, die auch direkt aufgerufen werden können.
 */
export async function requireUser(next = '/admin'): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`)
  return user
}
