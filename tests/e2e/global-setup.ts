import { prisma } from './helpers'

/** Läuft nach dem Start des Servers (dessen Befehl hat die Datenbank bereits frisch angelegt). */
export default async function globalSetup() {
  await prisma.event.deleteMany()
  await prisma.floorPlan.deleteMany()
  await prisma.user.deleteMany()
  await prisma.loginThrottle.deleteMany()
  await prisma.$disconnect()
}
