// app/lib/events/broadcast.ts
import type { Event } from '@prisma/client'
import { prisma } from '../prisma'
import { sendBroadcastMail } from '../booking-mail'
import { holdsUnits } from './occupancy'
import { tableOf } from './booking'
import { audit } from './booking-tx'
import { broadcastDelayMs, isRecipient, type RecipientFilter } from './admin-rules'

/**
 * Rundmail mit einfacher Warteschlange (docs/KONZEPT.md Abschnitt 7): Beim Absenden wird für jede*n
 * Empfänger*in eine MailLog-Zeile mit status "queued" angelegt. Ein Worker im selben Prozess holt die
 * Zeilen einzeln ab (queued -> sending, atomar per bedingtem Update - zwei Worker schicken also nie
 * dieselbe Mail) und verschickt sie mit Pause dazwischen (BROADCAST_MAILS_PER_MINUTE), damit der
 * Mailserver nicht drosselt oder sperrt.
 *
 * Angestoßen wird der Worker nach dem Absenden (after() in der Server Action), beim Serverstart
 * (instrumentation.ts) und vom Cron. Bleibt eine Zeile nach einem Neustart in "sending" hängen, ist
 * unklar, ob sie rausging - der Cron setzt sie auf failed statt sie womöglich doppelt zu schicken.
 *
 * Text und Buchungsdaten werden erst beim Versand zusammengesetzt: Wer inzwischen umgebucht hat,
 * bekommt den aktuellen Tisch; wer storniert hat, bekommt nichts mehr (status "skipped").
 */

export type BroadcastContent = { subject: string; body: string; includeIcs: boolean }

const STUCK_AFTER_MS = 10 * 60 * 1000

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

/** Legt die Rundmail und ihre Warteschlange an. Verschickt wird danach über processBroadcastQueue. */
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

async function sendQueued(logId: string) {
  const log = await prisma.mailLog.findUnique({ where: { id: logId }, include: { broadcast: true, booking: true, event: true } })
  if (!log?.broadcast) return
  const booking = log.booking
  if (!booking?.email || !holdsUnits(booking, new Date())) {
    await prisma.mailLog.update({ where: { id: logId }, data: { status: 'skipped', error: 'Buchung nicht mehr aktiv' } })
    return
  }
  // Adresse inzwischen korrigiert (nur bei unbestätigten Buchungen möglich): an die aktuelle.
  if (booking.email !== log.recipient) await prisma.mailLog.update({ where: { id: logId }, data: { recipient: booking.email } })
  const table = await tableOf(booking.id)
  await sendBroadcastMail(log.event, booking, table?.label ?? 'Tisch', log.broadcast, logId)
}

async function drain() {
  const delay = broadcastDelayMs(process.env.BROADCAST_MAILS_PER_MINUTE)
  for (;;) {
    const next = await prisma.mailLog.findFirst({ where: { status: 'queued' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } })
    if (!next) return
    const claimed = await prisma.mailLog.updateMany({ where: { id: next.id, status: 'queued' }, data: { status: 'sending', claimedAt: new Date() } })
    if (claimed.count === 0) continue
    try {
      await sendQueued(next.id)
    } catch (error) {
      console.error('[broadcast] Versand fehlgeschlagen:', error)
      await prisma.mailLog.update({ where: { id: next.id }, data: { status: 'failed', error: 'Interner Fehler beim Versand' } }).catch(() => {})
    }
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}

// Über globalThis statt Modulvariable: Next.js bündelt Server Actions, Route Handler und
// instrumentation.ts getrennt - so gibt es trotzdem nur einen Worker pro Prozess.
const state = globalThis as unknown as { broadcastWorker?: Promise<void> | null; broadcastRerun?: boolean }

/**
 * Verschickt alles, was in der Warteschlange steht. Läuft schon ein Worker, merkt er sich, dass
 * danach noch einmal nachgesehen werden soll - so geht keine gerade eingereihte Rundmail verloren.
 */
export function processBroadcastQueue(): Promise<void> {
  if (state.broadcastWorker) {
    state.broadcastRerun = true
    return state.broadcastWorker
  }
  state.broadcastWorker = (async () => {
    do {
      state.broadcastRerun = false
      await drain()
    } while (state.broadcastRerun)
  })().finally(() => {
    state.broadcastWorker = null
  })
  return state.broadcastWorker
}

/** Cron: nach einem Neustart hängengebliebene Zeilen als gescheitert markieren (nicht doppelt schicken). */
export async function failStuckBroadcastMails(now = new Date()): Promise<number> {
  const result = await prisma.mailLog.updateMany({
    where: { status: 'sending', claimedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    data: { status: 'failed', error: 'Versand unterbrochen – nicht erneut geschickt, um keine doppelte Mail zu verschicken' }
  })
  return result.count
}
