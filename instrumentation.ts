// instrumentation.ts

/**
 * Läuft einmal beim Start des Servers (node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/instrumentation.md). Setzt eine unterbrochene Mail-Warteschlange fort und startet
 * den Hintergrund-Durchlauf (app/lib/events/sweep.ts: Verfall, Angebote aus der Warteliste) - ohne
 * darauf zu warten, damit der Server sofort Anfragen annimmt. Nicht während `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const [{ processMailQueue }, { startSweeper }] = await Promise.all([import('./app/lib/events/mail-queue'), import('./app/lib/events/sweep')])
  processMailQueue().catch((error: unknown) => console.error('[mail-queue] Warteschlange beim Start:', error))
  startSweeper()
}
