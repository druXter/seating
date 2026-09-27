// app/lib/rsvp/rules.ts
import type { Message } from './token'

/**
 * Reine Regeln der Anbindung an rsvp-app (docs/KONZEPT.md Abschnitt 9) - ohne Datenbank testbar:
 * Kennung einer Buchung aus einer Zusage, Personen einer Zusage und der Abgleich mit der Gästeliste.
 */

export type RsvpGuest = Message<'guest-list'>['guests'][number]

/** Kennung einer Buchung aus einer Zusage: "rsvp:<rsvpEventId>:<rsvpId>". */
export function externalRefOf(rsvpEventId: string, rsvpId: string): string {
  return `rsvp:${rsvpEventId}:${rsvpId}`
}

/** rsvpId aus einer Kennung - nur, wenn sie zu diesem rsvp-Event gehört. */
export function rsvpIdOf(externalRef: string | null, rsvpEventId: string): string | null {
  if (!externalRef) return null
  const prefix = `rsvp:${rsvpEventId}:`
  return externalRef.startsWith(prefix) ? externalRef.slice(prefix.length) : null
}

/** Personenzahl einer Zusage: die Person selbst plus ihre Begleitungen. */
export function partySizeOf(guest: { companions: readonly (string | null)[] }): number {
  return 1 + guest.companions.length
}

export type GuestPerson = { key: string; name: string }

/** Personen einer Zusage (Sitzordnung): die Person, dann die Begleitungen - ohne Namen "Begleitung von …". */
export function personsOf(guest: { name: string; companions: readonly (string | null)[] }): GuestPerson[] {
  return [
    { key: 'guest', name: guest.name },
    ...guest.companions.map((companion, i) => ({ key: `companion-${i + 1}`, name: companion ?? `Begleitung von ${guest.name}`.slice(0, 100) }))
  ]
}

// --- Abgleich -----------------------------------------------------------------------------------

export type SyncKind = 'new' | 'changed' | 'removed'
/** Ein Eintrag der Abgleich-Vorschau. key: "<kind>:<rsvpId>", so wählen ihn die Checkboxen. */
export type SyncItem = { key: string; kind: SyncKind; rsvpId: string; title: string; details: string[] }

export type LinkedBooking = { id: string; externalRef: string | null; name: string; partySize: number; rsvpPartySize: number | null }
export type LinkedParty = { id: string; externalRef: string | null; name: string; persons: { id: string; externalKey: string | null; name: string }[] }

function item(kind: SyncKind, rsvpId: string, title: string, details: string[] = []): SyncItem {
  return { key: `${kind}:${rsvpId}`, kind, rsvpId, title, details }
}

function persons(n: number): string {
  return `${n} ${n === 1 ? 'Person' : 'Personen'}`
}

/**
 * Platzwahl über Zusagen (Zugang RSVP): Buchungen, deren Zusage es nicht mehr gibt (abgesagt, auf der
 * Warteliste, gelöscht), und solche, deren Name oder Personenzahl sich geändert hat. Zusagen ohne
 * Buchung sind kein Eintrag - die Gäste buchen selbst.
 */
export function diffBookings(bookings: readonly LinkedBooking[], guests: readonly RsvpGuest[], rsvpEventId: string): { items: SyncItem[]; unbooked: number } {
  const byId = new Map(guests.map(g => [g.rsvpId, g]))
  const items: SyncItem[] = []
  const booked = new Set<string>()
  for (const booking of bookings) {
    const rsvpId = rsvpIdOf(booking.externalRef, rsvpEventId)
    if (!rsvpId) continue
    booked.add(rsvpId)
    const guest = byId.get(rsvpId)
    if (!guest) {
      items.push(item('removed', rsvpId, booking.name, ['Keine Zusage mehr in rsvp-app – die Buchung wird storniert.']))
      continue
    }
    const details: string[] = []
    if (guest.name !== booking.name) details.push(`Name: ${booking.name} → ${guest.name}`)
    const known = booking.rsvpPartySize ?? booking.partySize
    if (partySizeOf(guest) !== known) details.push(`Personen: ${known} → ${partySizeOf(guest)}`)
    if (details.length > 0) items.push(item('changed', rsvpId, booking.name, details))
  }
  return { items, unbooked: guests.filter(g => !booked.has(g.rsvpId)).length }
}

export type PartyChange = {
  name: string | null
  rename: { attendeeId: string; from: string; to: string }[]
  add: GuestPerson[]
  remove: { attendeeId: string; name: string }[]
}

/**
 * Was sich an einer Gruppe ändern muss, damit sie der Zusage entspricht: Personen werden über ihren
 * externalKey zugeordnet ("guest", "companion-1", …). Personen ohne externalKey (von Hand ergänzt)
 * bleiben unangetastet.
 */
export function partyChange(party: LinkedParty, guest: RsvpGuest): PartyChange {
  const wanted = personsOf(guest)
  const byKey = new Map(party.persons.filter(p => p.externalKey).map(p => [p.externalKey!, p]))
  const change: PartyChange = { name: party.name !== guest.name ? guest.name : null, rename: [], add: [], remove: [] }
  for (const person of wanted) {
    const existing = byKey.get(person.key)
    if (!existing) change.add.push(person)
    else if (existing.name !== person.name) change.rename.push({ attendeeId: existing.id, from: existing.name, to: person.name })
  }
  const keys = new Set(wanted.map(p => p.key))
  for (const person of party.persons) {
    if (person.externalKey && !keys.has(person.externalKey)) change.remove.push({ attendeeId: person.id, name: person.name })
  }
  return change
}

export function isEmptyChange(change: PartyChange): boolean {
  return change.name === null && change.rename.length === 0 && change.add.length === 0 && change.remove.length === 0
}

/**
 * Sitzordnung (ASSIGNED): neue Zusagen (noch keine Gruppe), abgesagte bzw. weggefallene (Gruppe
 * vorhanden, Zusage nicht mehr) und geänderte (Name, Begleitungen). Nichts davon passiert von selbst.
 */
export function diffParties(parties: readonly LinkedParty[], guests: readonly RsvpGuest[], rsvpEventId: string): SyncItem[] {
  const byId = new Map(guests.map(g => [g.rsvpId, g]))
  const items: SyncItem[] = []
  const known = new Set<string>()
  for (const party of parties) {
    const rsvpId = rsvpIdOf(party.externalRef, rsvpEventId)
    if (!rsvpId) continue
    known.add(rsvpId)
    const guest = byId.get(rsvpId)
    if (!guest) {
      items.push(item('removed', rsvpId, party.name, ['Keine Zusage mehr in rsvp-app – die Gruppe wird abgesagt, ihre Plätze werden frei.']))
      continue
    }
    const change = partyChange(party, guest)
    if (isEmptyChange(change)) continue
    items.push(item('changed', rsvpId, party.name, [
      ...(change.name ? [`Gruppe: ${party.name} → ${change.name}`] : []),
      ...change.rename.map(r => `${r.from} → ${r.to}`),
      ...change.add.map(p => `neu: ${p.name}`),
      ...change.remove.map(p => `entfällt: ${p.name} (Platz wird frei)`)
    ]))
  }
  for (const guest of guests) {
    if (!known.has(guest.rsvpId)) items.push(item('new', guest.rsvpId, guest.name, [persons(partySizeOf(guest)) + (guest.companions.length > 0 ? `: ${personsOf(guest).map(p => p.name).join(', ')}` : '')]))
  }
  return items
}

/** Gewählte Einträge aus dem Formular (Checkboxen "item"), nur bekannte Formen. */
export function parseSyncKeys(values: readonly unknown[]): Set<string> {
  return new Set(values.filter((v): v is string => typeof v === 'string' && /^(new|changed|removed):[a-z0-9]{10,40}$/.test(v)).slice(0, 10_000))
}
