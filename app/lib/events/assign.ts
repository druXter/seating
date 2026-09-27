// app/lib/events/assign.ts
import type { Event, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { parseLayout } from '../floorplan/schema'
import { audit, isUniqueViolation, lockEvent, type Tx } from './booking-tx'
import { loadUnitStates } from './store'
import { seatGroups, type SeatGroup } from './seat-rules'
import { byLabel } from './admin-rules'
import { describePlaces } from './places'
import { groupOfSeat, partySeats, partySpread, type ImportParty, type PartyEdit, type PartyInput } from './assign-rules'

/**
 * Sitzordnung im Modus ASSIGNED (docs/KONZEPT.md Abschnitt 8, Zuordnungsmodus): Gruppen und Personen
 * anlegen (von Hand oder per CSV), Personen auf Plätze setzen, verschieben, tauschen, vom Platz nehmen,
 * ganze Gruppen zusammen setzen. Regeln: assign-rules.ts.
 *
 * Eine Gruppe ist eine Buchung (source ADMIN, CONFIRMED, ohne Kontaktdaten - es gibt in diesem Modus
 * keine Mails), jede Person ein Attendee. Platziert ist eine Person, wenn eine Allocation auf sie zeigt;
 * der Unique-Index Allocation(eventId, unitId) verhindert wie immer die Doppelbelegung eines Platzes,
 * Allocation.attendeeId (eindeutig), dass eine Person zwei Plätze hat. Veranstalter*innen dürfen alle
 * Plätze vergeben, auch nicht buchbare.
 *
 * Die Berechtigung prüfen die Server Actions (app/admin/events/arrange-actions.ts) VOR jedem Aufruf:
 * Konto mit Zugriff auf das Event, Event im Modus ASSIGNED. Personen und Gruppen werden hier immer
 * zusammen mit der eventId gesucht - eine id aus einem fremden Event gibt es für diese Funktionen nicht.
 */

type AssignEvent = Pick<Event, 'id'> & { layout: unknown }

export type AssignResult = { ok: true; message: string } | { ok: false; error: string }

const CONFLICT = 'Die Sitzordnung wurde inzwischen geändert (in einem anderen Fenster oder von einem anderen Konto). Die Ansicht ist jetzt aktuell – bitte versuch es noch einmal.'
const PARTY_CONFLICT = 'Die Gruppe wurde inzwischen geändert. Bitte lade die Seite neu und prüfe die Angaben.'

class Abort extends Error {}

function fail(error: string): AssignResult {
  return { ok: false, error }
}

// --- Gruppen ------------------------------------------------------------------------------------

async function insertParty(tx: Tx, eventId: string, party: PartyInput & { note?: string | null }, actor: string, imported = false) {
  const booking = await tx.booking.create({
    data: {
      eventId, status: 'CONFIRMED', source: 'ADMIN', name: party.name, email: null, partySize: party.persons.length,
      adminNote: party.note ?? null,
      attendees: { create: party.persons.map((name, position) => ({ eventId, name, position })) }
    }
  })
  await audit(tx, { eventId, bookingId: booking.id, actor, action: 'party-created', diff: { partySize: party.persons.length, ...(imported ? { imported: true } : {}) } })
  return booking
}

export async function createParty(event: AssignEvent, input: PartyInput & { note?: string | null }, actor: string): Promise<string> {
  const booking = await prisma.$transaction(tx => insertParty(tx, event.id, input, actor))
  return booking.id
}

/** CSV-Import (nach der Vorschau): alle Gruppen in einer Transaktion - ganz oder gar nicht. Nur ergänzen, nie löschen. */
export async function importParties(event: AssignEvent, parties: readonly ImportParty[], actor: string): Promise<number> {
  const persons = parties.reduce((sum, p) => sum + p.persons.length, 0)
  await prisma.$transaction(async tx => {
    for (const party of parties) await insertParty(tx, event.id, party, actor, true)
    await audit(tx, { eventId: event.id, bookingId: null, actor, action: 'guests-imported', diff: { parties: parties.length, persons } })
  }, { timeout: 30_000 })
  return persons
}

/**
 * Gruppe bearbeiten: Name, Personen umbenennen, entfernen (ihr Platz wird frei), hinzufügen. Baut auf
 * einem Stand auf (Booking.updatedAt) wie die übrigen Änderungsformulare der Veranstalter*innen.
 */
export async function updateParty(
  event: AssignEvent, bookingId: string, edit: PartyEdit, expected: Date, actor: string
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  try {
    const changed = await prisma.$transaction(async tx => {
      const booking = await tx.booking.findFirst({ where: { id: bookingId, eventId: event.id }, include: { attendees: { orderBy: { position: 'asc' } } } })
      if (!booking || booking.status !== 'CONFIRMED') throw new Abort('Diese Gruppe ist nicht mehr aktiv.')
      // Gruppen aus rsvp-app ändern sich nur über den Abgleich (app/lib/rsvp/sync.ts).
      if (booking.source === 'RSVP') throw new Abort('Diese Gruppe kommt aus rsvp-app – Namen und Begleitungen ändern sich über den Abgleich.')
      const known = new Map(booking.attendees.map(a => [a.id, a]))
      // Jede Person der Gruppe muss im Formular stehen und umgekehrt - sonst ist das Formular veraltet.
      if (edit.persons.length !== known.size || edit.persons.some(p => !known.has(p.id))) throw new Abort(PARTY_CONFLICT)
      const remaining = edit.persons.filter(p => !p.remove).length + edit.added.length
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: 'CONFIRMED', updatedAt: expected },
        data: { name: edit.name, partySize: remaining }
      })
      if (claimed.count === 0) throw new Abort(PARTY_CONFLICT)

      const removed = edit.persons.filter(p => p.remove).map(p => p.id)
      if (removed.length > 0) await tx.attendee.deleteMany({ where: { id: { in: removed }, bookingId: booking.id } })
      let renamed = 0
      for (const person of edit.persons) {
        if (person.remove || person.name === known.get(person.id)!.name) continue
        await tx.attendee.update({ where: { id: person.id }, data: { name: person.name } })
        renamed++
      }
      const next = booking.attendees.reduce((max, a) => Math.max(max, a.position), -1) + 1
      if (edit.added.length > 0) {
        await tx.attendee.createMany({ data: edit.added.map((name, i) => ({ eventId: event.id, bookingId: booking.id, name, position: next + i })) })
      }
      const diff: Prisma.InputJsonObject = {
        ...(booking.name !== edit.name ? { name: { from: booking.name, to: edit.name } } : {}),
        ...(booking.partySize !== remaining ? { partySize: { from: booking.partySize, to: remaining } } : {}),
        ...(renamed > 0 ? { renamed } : {})
      }
      if (Object.keys(diff).length > 0) await audit(tx, { eventId: event.id, bookingId: booking.id, actor, action: 'party-changed', diff })
      return Object.keys(diff).length > 0
    })
    return { ok: true, changed }
  } catch (error) {
    if (error instanceof Abort) return { ok: false, error: error.message }
    throw error
  }
}

// --- Plätze -------------------------------------------------------------------------------------

type SeatUnit = { id: string; key: string; label: string; tableKey: string | null }

function findSeat(tx: Tx, eventId: string, key: string): Promise<SeatUnit | null> {
  return tx.unit.findFirst({ where: { eventId, key, kind: 'SEAT' }, select: { id: true, key: true, label: true, tableKey: true } })
}

/** Person einer aktiven Gruppe dieses Events mit ihrem aktuellen Platz. */
function findAttendee(tx: Tx, eventId: string, attendeeId: string) {
  return tx.attendee.findFirst({
    where: { id: attendeeId, eventId, booking: { status: 'CONFIRMED' } },
    select: { id: true, name: true, bookingId: true, allocation: { select: { id: true, unit: { select: { id: true, key: true, label: true } } } } }
  })
}

/**
 * Person auf einen Platz setzen, umsetzen oder vom Platz nehmen (to null). from: der Platz, auf dem der
 * Client die Person gesehen hat (null = ohne Platz) - stimmt er nicht mehr, wird abgelehnt statt
 * überraschend umgesetzt. Ist der Zielplatz besetzt, tauschen die beiden: Die andere Person bekommt
 * den bisherigen Platz (oder steht wieder ohne Platz da, wenn die gezogene keinen hatte).
 */
export async function placeAttendee(event: AssignEvent, attendeeId: string, from: string | null, to: string | null, actor: string): Promise<AssignResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<AssignResult> => {
      await lockEvent(tx, event.id)
      const person = await findAttendee(tx, event.id, attendeeId)
      if (!person) throw new Abort('Diese Person gibt es nicht (mehr).')
      const current = person.allocation?.unit ?? null
      if ((current?.key ?? null) !== from) throw new Abort(CONFLICT)
      if (to === (current?.key ?? null)) return { ok: true, message: 'Nichts geändert.' }

      if (to === null) {
        await tx.allocation.delete({ where: { id: person.allocation!.id } })
        await audit(tx, { eventId: event.id, bookingId: person.bookingId, actor, action: 'unseated', diff: { person: person.name, seat: current!.label } })
        return { ok: true, message: `${person.name} hat keinen Platz mehr.` }
      }

      const target = await findSeat(tx, event.id, to)
      if (!target) throw new Abort('Diesen Platz gibt es nicht.')
      const occupant = await tx.allocation.findFirst({
        where: { eventId: event.id, unitId: target.id },
        select: { id: true, bookingId: true, attendee: { select: { id: true, name: true } } }
      })
      if (occupant && !occupant.attendee) throw new Abort(`${target.label} ist belegt.`)
      // Gemischte Belegung: Ein als Ganzes vergebener Tisch sperrt seine Plätze (im Modus ASSIGNED gibt
      // es keine Tisch-Buchungen, geprüft wird trotzdem).
      if (target.tableKey && (await tx.allocation.count({ where: { eventId: event.id, unit: { kind: 'TABLE', key: target.tableKey } } })) > 0) {
        throw new Abort(`${target.label} ist belegt.`)
      }

      if (person.allocation) await tx.allocation.delete({ where: { id: person.allocation.id } })
      if (occupant) await tx.allocation.delete({ where: { id: occupant.id } })
      await tx.allocation.create({ data: { eventId: event.id, unitId: target.id, bookingId: person.bookingId, attendeeId: person.id } })
      if (occupant && current) {
        await tx.allocation.create({ data: { eventId: event.id, unitId: current.id, bookingId: occupant.bookingId, attendeeId: occupant.attendee!.id } })
      }
      await audit(tx, { eventId: event.id, bookingId: person.bookingId, actor, action: 'seated', diff: { person: person.name, seat: { from: current?.label ?? null, to: target.label } } })
      if (occupant) {
        await audit(tx, {
          eventId: event.id, bookingId: occupant.bookingId, actor, action: current ? 'seated' : 'unseated',
          diff: current ? { person: occupant.attendee!.name, seat: { from: target.label, to: current.label } } : { person: occupant.attendee!.name, seat: target.label }
        })
      }
      if (!occupant) return { ok: true, message: `${person.name} sitzt jetzt auf ${target.label}.` }
      return {
        ok: true,
        message: current
          ? `${person.name} und ${occupant.attendee!.name} haben die Plätze getauscht.`
          : `${person.name} sitzt jetzt auf ${target.label}, ${occupant.attendee!.name} hat keinen Platz mehr.`
      }
    })
  } catch (error) {
    if (error instanceof Abort) return fail(error.message)
    if (isUniqueViolation(error)) return fail(CONFLICT)
    throw error
  }
}

function groupsOf(event: AssignEvent): SeatGroup[] {
  const parsed = parseLayout(event.layout)
  return parsed.ok ? seatGroups(parsed.layout) : []
}

/**
 * Alle Personen einer Gruppe, die noch keinen Platz haben, zusammen setzen - ab dem Zielplatz an
 * denselben Tisch bzw. nebeneinander in dieselbe Reihe (assign-rules.ts, partySeats). Ganz oder gar nicht.
 */
export async function placeParty(event: AssignEvent, bookingId: string, to: string, actor: string, now = new Date()): Promise<AssignResult> {
  const groups = groupsOf(event)
  try {
    return await prisma.$transaction(async (tx): Promise<AssignResult> => {
      await lockEvent(tx, event.id)
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, eventId: event.id, status: 'CONFIRMED' },
        select: { id: true, name: true, attendees: { where: { allocation: null }, orderBy: { position: 'asc' }, select: { id: true } } }
      })
      if (!booking) throw new Abort('Diese Gruppe gibt es nicht (mehr).')
      const persons = booking.attendees
      if (persons.length === 0) return { ok: true, message: `Alle aus „${booking.name}“ haben schon einen Platz.` }

      const target = await findSeat(tx, event.id, to)
      if (!target) throw new Abort('Diesen Platz gibt es nicht.')
      // Innerhalb der Transaktion gelesen: Nach lockEvent schreibt niemand sonst.
      const { units, states } = await loadUnitStates(event.id, now, tx)
      const free = new Set(units.filter(u => u.kind === 'SEAT' && (states.get(u.key) === 'free' || states.get(u.key) === 'unavailable')).map(u => u.key))
      const keys = partySeats(groups, free, to, persons.length)
      if (!keys) {
        const n = persons.length
        throw new Abort(free.has(to)
          ? `Ab ${target.label} sind keine ${n} Plätze zusammen frei (am selben Tisch bzw. nebeneinander in der Reihe). Setz die Personen einzeln oder wähle einen anderen Platz.`
          : `${target.label} ist belegt.`)
      }
      const seats = await tx.unit.findMany({ where: { eventId: event.id, key: { in: keys } }, select: { id: true, key: true, label: true } })
      const byKey = new Map(seats.map(s => [s.key, s]))
      await tx.allocation.createMany({ data: keys.map((key, i) => ({ eventId: event.id, unitId: byKey.get(key)!.id, bookingId: booking.id, attendeeId: persons[i].id })) })
      const label = describePlaces(keys.map(key => ({ label: byKey.get(key)!.label, kind: 'SEAT' as const })))
      await audit(tx, { eventId: event.id, bookingId: booking.id, actor, action: 'seated', diff: { persons: persons.length, seats: label } })
      return { ok: true, message: `„${booking.name}“ sitzt jetzt zusammen: ${label}.` }
    })
  } catch (error) {
    if (error instanceof Abort) return fail(error.message)
    // Ein Platz wurde gleichzeitig vergeben (Unique-Index) - nichts ist passiert.
    if (isUniqueViolation(error)) return fail(CONFLICT)
    throw error
  }
}

// --- Ansicht ------------------------------------------------------------------------------------

export type BoardPerson = { id: string; name: string; seatKey: string | null }
export type BoardParty = { id: string; name: string; adminNote: string | null; persons: BoardPerson[]; spread: string[] }
export type BoardSeat = { key: string; label: string; group: string; bookable: boolean; attendeeId: string | null }

/**
 * Daten für die Sitzordnung (app/ui/plan/arrange-board.tsx): Gruppen mit Personen und Platz, alle
 * Plätze in Plan-Reihenfolge mit ihrer Gruppe (Tisch/Reihe) und der Person darauf. spread: Tische bzw.
 * Reihen, auf die sich eine Gruppe verteilt (mehr als einer = getrennt).
 */
export async function loadSeatingBoard(event: AssignEvent) {
  const groups = groupsOf(event)
  const [units, parties] = await Promise.all([
    prisma.unit.findMany({ where: { eventId: event.id, kind: 'SEAT' }, select: { key: true, label: true, bookable: true, allocations: { select: { attendeeId: true } } } }),
    prisma.booking.findMany({
      where: { eventId: event.id, status: 'CONFIRMED' },
      select: {
        id: true, name: true, adminNote: true,
        attendees: { orderBy: { position: 'asc' }, select: { id: true, name: true, allocation: { select: { unit: { select: { key: true } } } } } }
      }
    })
  ])
  const groupOf = groupOfSeat(groups)
  const labels = new Map(units.map(u => [u.key, u.label]))
  const groupLabel = new Map<string, string>()
  for (const group of groups) for (const key of group.segments.flat()) groupLabel.set(key, group.kind === 'single' ? 'Einzelplätze' : group.label)
  const order = new Map(groups.flatMap(g => g.segments.flat()).map((key, index) => [key, index]))

  const seats: BoardSeat[] = units
    .sort((a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9))
    .map(u => ({ key: u.key, label: u.label, group: groupLabel.get(u.key) ?? 'Weitere Plätze', bookable: u.bookable, attendeeId: u.allocations[0]?.attendeeId ?? null }))
  const boardParties: BoardParty[] = parties.map(party => {
    const persons = party.attendees.map(a => ({ id: a.id, name: a.name, seatKey: a.allocation?.unit.key ?? null }))
    const spread = partySpread(persons.flatMap(p => (p.seatKey ? [p.seatKey] : [])), groupOf)
      .map(group => (group.startsWith('single:') ? labels.get(group.slice('single:'.length)) ?? group : group))
    return { id: party.id, name: party.name, adminNote: party.adminNote, persons, spread }
  }).sort(byName)
  return { parties: boardParties, seats }
}

function byName(a: { name: string }, b: { name: string }): number {
  return byLabel({ label: a.name }, { label: b.name })
}

/** Zähler für Übersicht und Liste: Personen gesamt und davon platziert (aktive Gruppen). */
export async function seatingCounts(eventId: string): Promise<{ persons: number; seated: number; parties: number }> {
  const [persons, seated, parties] = await Promise.all([
    prisma.attendee.count({ where: { eventId, booking: { status: 'CONFIRMED' } } }),
    prisma.attendee.count({ where: { eventId, booking: { status: 'CONFIRMED' }, allocation: { isNot: null } } }),
    prisma.booking.count({ where: { eventId, status: 'CONFIRMED' } })
  ])
  return { persons, seated, parties }
}
