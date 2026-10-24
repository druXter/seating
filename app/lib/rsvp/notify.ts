// app/lib/rsvp/notify.ts
import { prisma } from '../prisma'
import { describePlaces } from '../events/places'
import { rsvpAppOrigin, rsvpSecret } from './config'
import { createMessage } from './token'
import { personPlaces, rsvpIdOf } from './rules'

/**
 * Rückmeldung der Platzierungen an rsvp-app (docs/KONZEPT.md Abschnitt 9, A.4): damit Gäste dort "Dein
 * Platz: Tisch 7, Plätze 3, 4" sehen und der Einlass es anzeigen kann. Dazu, wo bekannt, Tisch und Platz pro Person
 * (personPlaces) für die Küchenliste pro Tisch. Geschickt wird immer der
 * VOLLSTÄNDIGE Stand eines verknüpften Events (token.ts, placements) - rsvp-app setzt die genannten
 * und löscht alle anderen. So braucht es keine Meldung pro Änderung, gelöschte Buchungen fallen von
 * selbst heraus, und eine verlorene Meldung heilt die nächste.
 *
 * Best-effort mit kurzem Timeout wie die übrigen Kopplungen der Suite: Ein nicht erreichbares rsvp-app
 * darf keine Buchung verzögern oder scheitern lassen. Gibt zurück, ob rsvp-app angenommen hat.
 * clear: leeren Stand melden (vor dem Löschen des Events).
 */
export async function reportPlacements(eventId: string, options: { clear?: boolean } = {}): Promise<boolean> {
  const secret = rsvpSecret()
  const origin = rsvpAppOrigin()
  if (!secret || !origin) return false
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, rsvpEventId: true } })
  if (!event?.rsvpEventId) return false
  const rsvpEventId = event.rsvpEventId

  // clear: das Event wird gelöscht - rsvp-app soll alle Platzangaben dazu vergessen.
  const [bookings, tables] = options.clear ? [[], []] : await Promise.all([
    prisma.booking.findMany({
      where: { eventId, status: 'CONFIRMED', externalRef: { startsWith: `rsvp:${rsvpEventId}:` }, allocations: { some: {} } },
      select: {
        externalRef: true, partySize: true,
        allocations: { select: { unit: { select: { label: true, kind: true, tableKey: true } }, attendee: { select: { externalKey: true } } }, orderBy: { unit: { key: 'asc' } } }
      }
    }),
    prisma.unit.findMany({ where: { eventId, kind: 'TABLE' }, select: { key: true, label: true } })
  ])
  const tableLabels = new Map(tables.map(t => [t.key, t.label]))
  const placements = bookings.flatMap(b => {
    const rsvpId = rsvpIdOf(b.externalRef, rsvpEventId)
    if (!rsvpId) return []
    const persons = personPlaces(b.partySize, b.allocations.map(a => ({ unit: a.unit, attendeeKey: a.attendee?.externalKey ?? null })), tableLabels)
      ?.map(p => ({ ...p, table: p.table?.slice(0, 200) ?? null, seat: p.seat?.slice(0, 200) ?? null }))
    return [{ rsvpId, label: describePlaces(b.allocations.map(a => a.unit)).slice(0, 500), ...(persons ? { persons } : {}) }]
  })
  const body = createMessage('placements', { aud: origin, seatingEventId: event.id, rsvpEventId, placements }, secret)
  try {
    const response = await fetch(`${origin}/api/seating/placements`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, redirect: 'error', signal: AbortSignal.timeout(5000)
    })
    return response.ok
  } catch {
    return false
  }
}
