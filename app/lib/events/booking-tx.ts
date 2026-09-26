// app/lib/events/booking-tx.ts
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { HOLDING_STATUSES } from './occupancy'

/**
 * Bausteine, die Buchende (booking.ts) und Veranstalter*innen (admin-booking.ts) gleich brauchen:
 * Protokoll, Sperre pro Event, Freigabe abgelaufener Holds. Doppelbuchung verhindert weiterhin der
 * Unique-Index Allocation(eventId, unitId) - die Funktionen hier bereiten das Einfügen nur vor.
 */

export type Tx = Prisma.TransactionClient

/** "customer", "system" oder die id des handelnden Kontos. */
export type Actor = 'customer' | 'system' | (string & {})

export async function audit(
  db: Tx | typeof prisma,
  entry: { eventId: string; bookingId: string | null; actor: Actor; action: string; diff?: Prisma.InputJsonValue }
) {
  await db.auditLog.create({ data: { ...entry, diff: entry.diff ?? {} } })
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** Aktive Buchung: bestätigt oder mit noch gültigem Hold (Konzept Abschnitt 5). */
export function activeWhere(now: Date): Prisma.BookingWhereInput {
  return { OR: [{ status: 'CONFIRMED' }, { status: { in: [...HOLDING_STATUSES] }, expiresAt: { gt: now } }] }
}

/**
 * SQLite erlaubt nur einen Schreiber gleichzeitig, sperrt bei einer "deferred" Transaktion aber erst
 * beim ersten Schreiben. Diese Anweisung schreibt als ERSTES - damit sehen die folgenden Prüfungen
 * (eine Buchung pro E-Mail, Obergrenze pro IP) einen festen Stand, und zwei gleichzeitige Anfragen
 * können nicht beide an ihnen vorbeikommen.
 */
export async function lockEvent(tx: Tx, eventId: string) {
  await tx.$executeRaw`UPDATE "Event" SET "id" = "id" WHERE "id" = ${eventId}`
}

/** Abgelaufene Holds auf den angegebenen Einheiten auf EXPIRED setzen und ihre Allocations löschen (Konzept Abschnitt 5, Schritt 1). */
export async function releaseStaleHolds(tx: Tx, eventId: string, unitIds: string[], now: Date) {
  const stale = await tx.booking.findMany({
    where: { eventId, status: { in: [...HOLDING_STATUSES] }, expiresAt: { lte: now }, allocations: { some: { unitId: { in: unitIds } } } },
    select: { id: true }
  })
  if (stale.length === 0) return
  const ids = stale.map(b => b.id)
  await tx.allocation.deleteMany({ where: { bookingId: { in: ids } } })
  await tx.booking.updateMany({ where: { id: { in: ids } }, data: { status: 'EXPIRED', pendingIpHash: null, verifyTokenHash: null, verifyCodeHmac: null } })
  for (const id of ids) await audit(tx, { eventId, bookingId: id, actor: 'system', action: 'expired' })
}

/**
 * Gemischte Belegung (Konzept Abschnitt 3): Ist einer der Plätze dieses Tisches einzeln belegt, ist
 * der Tisch nicht frei. Im Modus TABLE gibt es keine Platz-Buchungen, geprüft wird trotzdem.
 * excludeBookingId: die eigene Buchung (beim Wechsel) zählt nicht.
 */
export async function tableSeatsTaken(tx: Tx, eventId: string, tableKey: string, now: Date, excludeBookingId?: string): Promise<boolean> {
  const count = await tx.allocation.count({
    where: {
      eventId, unit: { tableKey }, booking: activeWhere(now),
      ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {})
    }
  })
  return count > 0
}
