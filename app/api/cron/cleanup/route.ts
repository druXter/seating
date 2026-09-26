import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { safeEqual } from '../../../lib/permissions'
import { deleteUpload } from '../../../lib/uploads'

// Suite-weit einheitliche Fristen (siehe suite-kit README "Betrieb"), damit die
// Datenschutzerklärungen aller Tools dieselben Zeiträume nennen können.
const ACCOUNT_INACTIVITY_YEARS = 2
const EVENT_RETENTION_MONTHS = 18

/**
 * Automatischer Cron-Endpunkt für Uptime Kuma o.Ä. (Speicherbegrenzung, Art. 5 Abs. 1 lit. e
 * DSGVO), gleiches Muster wie im Abstimmungstool und in rsvp-app. Läuft idempotent, einmal
 * täglich reicht.
 *
 * Stand Phase 2:
 * 1. Löscht Events EVENT_RETENTION_MONTHS nach ihrem Ende - samt Einheiten, Buchungen, Belegungen,
 *    Freigaben (Cascade) und Hintergrundbild.
 * 2. Löscht Konten, die seit ACCOUNT_INACTIVITY_YEARS nicht mehr eingeloggt waren - bewusst
 *    NICHT Admin-Konten (sie sind eine fortlaufende Identität) und nicht Konten, denen noch
 *    Raumpläne oder Events gehören (wie im Abstimmungstool bei Abstimmungen).
 * 3. Räumt Technisches auf: abgelaufene Sitzungen, abgelaufene Einladungs-/Reset-Links,
 *    veraltete Drossel-Zähler.
 *
 * Später dazu (siehe docs/KONZEPT.md Abschnitte 5 und 11): abgelaufene PENDING-Buchungen auf
 * EXPIRED setzen, abgelaufene/stornierte Buchungen nach 30 Tagen entfernen.
 */
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret')
  const expected = process.env.CRON_SECRET

  // Ein leeres/fehlendes CRON_SECRET darf den Endpunkt NICHT freischalten.
  if (!expected || !secret || !safeEqual(secret, expected)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const now = new Date()

  const eventCutoff = new Date(now)
  eventCutoff.setMonth(eventCutoff.getMonth() - EVENT_RETENTION_MONTHS)
  const oldEvents = await prisma.event.findMany({ where: { endsAt: { lt: eventCutoff } }, select: { id: true, backgroundFile: true } })
  const deletedEvents = await prisma.event.deleteMany({ where: { id: { in: oldEvents.map(e => e.id) } } })
  for (const event of oldEvents) await deleteUpload(event.backgroundFile)

  const inactivityCutoff = new Date(now)
  inactivityCutoff.setFullYear(inactivityCutoff.getFullYear() - ACCOUNT_INACTIVITY_YEARS)

  // Sitzungen, Verknüpfungen und Freigaben verschwinden per Cascade mit dem Konto.
  const deletedUsers = await prisma.user.deleteMany({
    where: { role: { not: 'ADMIN' }, lastLoginAt: { lt: inactivityCutoff }, floorPlans: { none: {} }, events: { none: {} } }
  })

  const deletedSessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })
  await prisma.user.updateMany({
    where: { resetTokenExpiresAt: { lt: now } },
    data: { resetTokenHash: null, resetTokenExpiresAt: null }
  })
  await prisma.loginThrottle.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } })

  return NextResponse.json({
    deletedEvents: deletedEvents.count,
    deletedUsers: deletedUsers.count,
    deletedSessions: deletedSessions.count
  })
}
