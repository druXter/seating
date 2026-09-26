// instrumentation.ts

/**
 * Läuft einmal beim Start des Servers (node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/instrumentation.md). Setzt eine Rundmail fort, deren Versand ein Neustart
 * unterbrochen hat (app/lib/events/broadcast.ts) - ohne darauf zu warten, damit der Server sofort
 * Anfragen annimmt. Nicht während `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const { processBroadcastQueue } = await import('./app/lib/events/broadcast')
  processBroadcastQueue().catch(error => console.error('[broadcast] Warteschlange beim Start:', error))
}
