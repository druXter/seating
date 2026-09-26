import { prisma } from './helpers'
import { startMailServer } from './mail-server'

/**
 * Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt).
 * Startet den Test-SMTP (tests/e2e/mail-server.ts); die zurückgegebene Funktion beendet ihn am Ende.
 */
export default async function globalSetup() {
  const mailServer = await startMailServer()
  await prisma.event.deleteMany()
  await prisma.floorPlan.deleteMany()
  await prisma.user.deleteMany()
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
  return () => new Promise<void>(resolve => mailServer.close(() => resolve()))
}
