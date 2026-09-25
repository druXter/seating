// app/lib/permissions.ts
import { timingSafeEqual } from 'node:crypto'
import type { CurrentUser } from './auth'

/**
 * Rollen wie im Abstimmungstool (siehe prisma/schema.prisma, enum Role). Die Prüfung pro
 * Event (Owner, Admin oder per EventAccess freigegeben) kommt mit Phase 2 hierher - wie
 * getPollLevel im Abstimmungstool als EINE zentrale Stelle für jede Seite und Server Action.
 */
export function canCreateEvents(user: CurrentUser): boolean {
  return user.role !== 'MODERATOR'
}

/** Konstantzeitvergleich für Tokens - `===` würde über die Antwortzeit verraten, wie viele Zeichen stimmen. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
