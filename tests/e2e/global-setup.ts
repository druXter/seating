import { prisma } from './helpers'
import { startMailServer } from './mail-server'
import { startRsvpServer } from './rsvp-server'
import { BASE_URL } from '../../playwright.config'

/**
 * Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt).
 * Startet den Test-SMTP (tests/e2e/mail-server.ts) und das Test-Doppel für rsvp-app
 * (tests/e2e/rsvp-server.ts); die zurückgegebene Funktion beendet beide am Ende.
 */
export default async function globalSetup() {
  const mailServer = await startMailServer()
  const rsvpServer = await startRsvpServer(new URL(BASE_URL).origin)
  await prisma.event.deleteMany()
  await prisma.floorPlan.deleteMany()
  await prisma.user.deleteMany()
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
  return async () => {
    await new Promise<void>(resolve => mailServer.close(() => resolve()))
    await new Promise<void>(resolve => rsvpServer.close(() => resolve()))
  }
}
