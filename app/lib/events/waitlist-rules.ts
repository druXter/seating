// app/lib/events/waitlist-rules.ts
import { tableFits } from './occupancy'

/**
 * Reine Regeln der Warteliste (docs/KONZEPT.md Abschnitt 5) - ohne Datenbank testbar. Die Abläufe
 * stehen in waitlist.ts.
 */

/** So lange hat man Zeit, den Eintrag per Mail zu bestätigen (es wird dabei kein Tisch blockiert). */
export const WAITLIST_VERIFY_HOURS = 24
export const OFFER_TTL_RANGE = { min: 1, max: 24 * 7 } as const

type Table = { key: string; label: string; capacity: number }
type Entry = { id: string; partySize: number; waitlistedAt: Date }

/**
 * Wer bekommt welchen freien Tisch? Jeder freie Tisch - kleinste zuerst, damit große Tische für große
 * Gruppen bleiben - geht an den am längsten wartenden Eintrag, zu dem er passt (Gruppengröße und
 * Mindestbelegung). Passende Einträge werden also vorgezogen; große Gruppen können länger warten.
 */
export function planOffers<T extends Table>(freeTables: readonly T[], entries: readonly Entry[], minFillRatio: number | null): { bookingId: string; table: T }[] {
  const tables = [...freeTables].sort((a, b) => a.capacity - b.capacity || a.label.localeCompare(b.label, 'de', { numeric: true }))
  const waiting = [...entries].sort((a, b) => a.waitlistedAt.getTime() - b.waitlistedAt.getTime() || a.id.localeCompare(b.id))
  const taken = new Set<string>()
  const offers: { bookingId: string; table: T }[] = []
  for (const table of tables) {
    const entry = waiting.find(e => !taken.has(e.id) && tableFits(table.capacity, e.partySize, minFillRatio))
    if (!entry) continue
    taken.add(entry.id)
    offers.push({ bookingId: entry.id, table })
  }
  return offers
}

/** Frist eines Angebots: offerTtlHours ab jetzt, aber nie über den Buchungsschluss hinaus. */
export function offerDeadline(now: Date, event: { offerTtlHours: number; startsAt: Date; bookingClosesAt: Date | null }): Date {
  const closes = event.bookingClosesAt && event.bookingClosesAt < event.startsAt ? event.bookingClosesAt : event.startsAt
  const ttl = new Date(now.getTime() + event.offerTtlHours * 60 * 60 * 1000)
  return ttl < closes ? ttl : closes
}

export type WaitlistChoice = 'free' | 'waitlist' | 'too-large' | 'off'

/**
 * Was kann eine Gruppe gerade tun? "free": ein passender Tisch ist frei (direkt buchen); "waitlist":
 * keiner frei, aber es gibt passende Tische (eintragen); "too-large": kein Tisch passt überhaupt
 * (ein Eintrag würde nie ein Angebot bekommen); "off": Warteliste abgeschaltet.
 */
export function waitlistChoice(
  tables: readonly { capacity: number; bookable: boolean; free: boolean }[], partySize: number, minFillRatio: number | null, enabled: boolean
): WaitlistChoice {
  const fitting = tables.filter(t => t.bookable && tableFits(t.capacity, partySize, minFillRatio))
  if (fitting.some(t => t.free)) return 'free'
  if (fitting.length === 0) return 'too-large'
  return enabled ? 'waitlist' : 'off'
}
