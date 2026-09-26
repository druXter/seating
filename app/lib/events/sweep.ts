// app/lib/events/sweep.ts
import { expireStaleBookings } from './booking'
import { offerAllWaitlists } from './waitlist'
import { failStuckMails, processMailQueue } from './mail-queue'

/**
 * Hintergrund-Durchlauf (instrumentation.ts, jede Minute; zusätzlich im Cron): Abgelaufene
 * Reservierungen und Angebote machen Tische frei, ohne dass eine Anfrage kommt. Der Durchlauf setzt sie
 * auf EXPIRED, bietet die Tische der Warteliste an und verschickt, was in der Mail-Warteschlange steht.
 * Idempotent - gleichzeitige Durchläufe schaden nicht (bedingte Updates, Unique-Index).
 */
export async function sweep(now = new Date()) {
  const expiredEvents = await expireStaleBookings(now)
  const stuckMails = await failStuckMails(now)
  const offers = await offerAllWaitlists(now)
  void processMailQueue().catch(error => console.error('[sweep] Mail-Warteschlange:', error))
  return { expiredEvents: expiredEvents.length, stuckMails, offers }
}

const state = globalThis as unknown as { sweepTimer?: ReturnType<typeof setInterval> }

/**
 * Startet den Durchlauf im Serverprozess. SWEEP_INTERVAL_SECONDS (Standard 60, 0 = aus - z.B. in den
 * E2E-Tests, die den Durchlauf gezielt über den Cron auslösen).
 */
export function startSweeper() {
  const seconds = Number.parseInt(process.env.SWEEP_INTERVAL_SECONDS ?? '60', 10)
  if (state.sweepTimer || !Number.isInteger(seconds) || seconds <= 0) return
  let running = false
  state.sweepTimer = setInterval(() => {
    if (running) return
    running = true
    sweep().catch(error => console.error('[sweep] Fehler:', error)).finally(() => { running = false })
  }, seconds * 1000)
  state.sweepTimer.unref?.()
}
