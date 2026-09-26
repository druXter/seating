// app/lib/permissions.ts
import { timingSafeEqual } from 'node:crypto'
import type { CurrentUser } from './auth'

/** Rollen wie im Abstimmungstool (siehe prisma/schema.prisma, enum Role). */
export function canCreateEvents(user: CurrentUser): boolean {
  return user.role !== 'MODERATOR'
}

/** Raumpläne anlegen dürfen dieselben Rollen wie Events (nicht Moderator*innen). */
export const canCreatePlans = canCreateEvents

/**
 * edit: ändern, löschen, freigeben (Besitzer*in oder Admin)
 * view: ansehen, exportieren, duplizieren (als gemeinsame Vorlage angeboten, für alle außer
 *       Moderator*innen - die legen nichts an und brauchen deshalb auch keine Vorlagen)
 *
 * DIE zentrale Prüfung für Raumpläne - jede Seite, jede Server Action und jeder Route Handler
 * geht hierüber.
 */
export type PlanAccess = 'edit' | 'view'

export function planAccess(user: CurrentUser, plan: { ownerId: string | null; shared: boolean }): PlanAccess | null {
  if (user.role === 'ADMIN' || (plan.ownerId !== null && plan.ownerId === user.id)) return 'edit'
  if (plan.shared && user.role !== 'MODERATOR') return 'view'
  return null
}

/**
 * owner:     alles (bearbeiten, Plan ändern, löschen, freigeben) - Besitzer*in oder Admin
 * moderator: per EventAccess freigegeben - alles außer löschen und weiter freigeben
 *
 * DIE zentrale Prüfung für Events (wie getPollLevel im Abstimmungstool). Die Freigabe fragt
 * app/lib/events/store.ts aus der Datenbank ab und reicht sie hier herein, damit die Regel selbst
 * ohne Datenbank testbar bleibt. Jede Seite, Server Action und jeder Route Handler geht über
 * loadEventForUser (dort) und damit über diese Funktion.
 */
export type EventLevel = 'owner' | 'moderator'

export function eventLevel(user: CurrentUser, event: { ownerId: string | null }, hasShare: boolean): EventLevel | null {
  if (user.role === 'ADMIN' || (event.ownerId !== null && event.ownerId === user.id)) return 'owner'
  return hasShare ? 'moderator' : null
}

/** Konstantzeitvergleich für Tokens - `===` würde über die Antwortzeit verraten, wie viele Zeichen stimmen. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
