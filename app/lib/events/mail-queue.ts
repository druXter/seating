// app/lib/events/mail-queue.ts
import { prisma } from '../prisma'
import { sendBroadcastMail, sendOfferExpiredMail, sendOfferMail } from '../booking-mail'
import { holdsUnits } from './occupancy'
import { tableOf } from './booking'
import { broadcastDelayMs } from './admin-rules'

/**
 * Einfache Mail-Warteschlange in der Datenbank: MailLog-Zeilen mit status "queued". Ein Worker im
 * selben Prozess holt sie einzeln ab (queued -> sending, atomar per bedingtem Update - zwei Worker
 * schicken also nie dieselbe Mail) und verschickt sie mit Pause dazwischen
 * (BROADCAST_MAILS_PER_MINUTE), damit der Mailserver nicht drosselt oder sperrt.
 *
 * Eingereiht werden Rundmails (broadcast.ts) sowie Angebote aus der Warteliste und deren Verfall
 * (waitlist.ts, booking-tx.ts) - letztere in derselben Transaktion wie der Statuswechsel, damit keine
 * Mail verloren geht. Einzelmails gehen vor Rundmails.
 *
 * Angestoßen wird der Worker nach dem Einreihen (after()), beim Serverstart und vom Hintergrund-
 * Durchlauf (instrumentation.ts) sowie vom Cron. Bleibt eine Zeile nach einem Neustart in "sending"
 * hängen, ist unklar, ob sie rausging - sie wird auf failed gesetzt statt womöglich doppelt verschickt.
 */

const STUCK_AFTER_MS = 10 * 60 * 1000

async function sendQueued(logId: string) {
  const log = await prisma.mailLog.findUnique({ where: { id: logId }, include: { broadcast: true, booking: true, event: true } })
  if (!log) return
  const booking = log.booking
  const skip = (reason: string) => prisma.mailLog.update({ where: { id: logId }, data: { status: 'skipped', error: reason } })
  if (!booking?.email) return void (await skip('Buchung gibt es nicht mehr'))
  // Adresse inzwischen korrigiert (nur bei unbestätigten Buchungen möglich): an die aktuelle.
  if (booking.email !== log.recipient) await prisma.mailLog.update({ where: { id: logId }, data: { recipient: booking.email } })

  switch (log.type) {
    case 'broadcast': {
      if (!log.broadcast || !holdsUnits(booking, new Date())) return void (await skip('Buchung nicht mehr aktiv'))
      const table = await tableOf(booking.id)
      await sendBroadcastMail(log.event, booking, table?.label ?? 'Tisch', log.broadcast, logId)
      return
    }
    case 'offer': {
      if (booking.status !== 'OFFERED' || !holdsUnits(booking, new Date())) return void (await skip('Angebot nicht mehr offen'))
      const table = await tableOf(booking.id)
      await sendOfferMail(log.event, booking, table?.label ?? 'Tisch', booking.expiresAt!, logId)
      return
    }
    case 'offer-expired':
      if (booking.status !== 'EXPIRED') return void (await skip('Angebot nicht verfallen'))
      await sendOfferExpiredMail(log.event, booking, logId)
      return
    default:
      await prisma.mailLog.update({ where: { id: logId }, data: { status: 'failed', error: `Unbekannte Art ${log.type}` } })
  }
}

async function nextQueued() {
  return (await prisma.mailLog.findFirst({ where: { status: 'queued', type: { not: 'broadcast' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } }))
    ?? (await prisma.mailLog.findFirst({ where: { status: 'queued' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } }))
}

async function drain() {
  const delay = broadcastDelayMs(process.env.BROADCAST_MAILS_PER_MINUTE)
  for (;;) {
    const next = await nextQueued()
    if (!next) return
    const claimed = await prisma.mailLog.updateMany({ where: { id: next.id, status: 'queued' }, data: { status: 'sending', claimedAt: new Date() } })
    if (claimed.count === 0) continue
    try {
      await sendQueued(next.id)
    } catch (error) {
      console.error('[mail-queue] Versand fehlgeschlagen:', error)
      await prisma.mailLog.update({ where: { id: next.id }, data: { status: 'failed', error: 'Interner Fehler beim Versand' } }).catch(() => {})
    }
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}

// Über globalThis statt Modulvariable: Next.js bündelt Server Actions, Route Handler und
// instrumentation.ts getrennt - so gibt es trotzdem nur einen Worker pro Prozess.
const state = globalThis as unknown as { mailQueueWorker?: Promise<void> | null; mailQueueRerun?: boolean }

/**
 * Verschickt alles, was in der Warteschlange steht. Läuft schon ein Worker, merkt er sich, dass
 * danach noch einmal nachgesehen werden soll - so geht keine gerade eingereihte Mail verloren.
 */
export function processMailQueue(): Promise<void> {
  if (state.mailQueueWorker) {
    state.mailQueueRerun = true
    return state.mailQueueWorker
  }
  state.mailQueueWorker = (async () => {
    do {
      state.mailQueueRerun = false
      await drain()
    } while (state.mailQueueRerun)
  })().finally(() => {
    state.mailQueueWorker = null
  })
  return state.mailQueueWorker
}

/** Nach einem Neustart hängengebliebene Zeilen als gescheitert markieren (nicht doppelt schicken). */
export async function failStuckMails(now = new Date()): Promise<number> {
  const result = await prisma.mailLog.updateMany({
    where: { status: 'sending', claimedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
    data: { status: 'failed', error: 'Versand unterbrochen – nicht erneut geschickt, um keine doppelte Mail zu verschicken' }
  })
  return result.count
}
