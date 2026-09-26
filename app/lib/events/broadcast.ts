// app/lib/events/broadcast.ts
import type { Event } from '@prisma/client'
import { prisma } from '../prisma'
import { audit } from './booking-tx'
import { isRecipient, type RecipientFilter } from './admin-rules'

/**
 * Rundmail (docs/KONZEPT.md Abschnitt 7): Beim Absenden wird für jede*n Empfänger*in eine MailLog-Zeile
 * mit status "queued" angelegt; verschickt wird gedrosselt über die Warteschlange in mail-queue.ts.
 * Text und Buchungsdaten werden erst beim Versand zusammengesetzt: Wer inzwischen umgebucht hat,
 * bekommt den aktuellen Tisch; wer storniert hat, bekommt nichts mehr (status "skipped").
 */

export type BroadcastContent = { subject: string; body: string; includeIcs: boolean }

/** Aktive Buchungen mit Adresse, die zum Filter passen. */
export async function broadcastRecipients(eventId: string, filter: RecipientFilter, now = new Date()) {
  const bookings = await prisma.booking.findMany({
    where: { eventId, email: { not: null }, status: { in: ['CONFIRMED', 'PENDING'] } },
    select: { id: true, email: true, status: true, expiresAt: true, allocations: { select: { unit: { select: { key: true } } } } },
    orderBy: { createdAt: 'asc' }
  })
  return bookings
    .map(b => ({ id: b.id, email: b.email, status: b.status, expiresAt: b.expiresAt, tableKeys: b.allocations.map(a => a.unit.key) }))
    .filter(b => isRecipient(b, filter, now))
}

/** Legt die Rundmail und ihre Warteschlange an. Verschickt wird danach über processMailQueue. */
export async function queueBroadcast(event: Pick<Event, 'id'>, content: BroadcastContent, filter: RecipientFilter, actor: string, now = new Date()) {
  const recipients = await broadcastRecipients(event.id, filter, now)
  if (recipients.length === 0) return { broadcastId: null, count: 0 }
  const broadcast = await prisma.$transaction(async tx => {
    const created = await tx.broadcast.create({
      data: {
        eventId: event.id, subject: content.subject, body: content.body, includeIcs: content.includeIcs, createdById: actor,
        mails: { createMany: { data: recipients.map(r => ({ eventId: event.id, bookingId: r.id, type: 'broadcast', recipient: r.email!, status: 'queued' })) } }
      }
    })
    await audit(tx, { eventId: event.id, bookingId: null, actor, action: 'broadcast', diff: { subject: content.subject, recipients: recipients.length } })
    return created
  })
  return { broadcastId: broadcast.id, count: recipients.length }
}
