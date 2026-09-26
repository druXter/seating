// app/lib/events/booking-changes.ts

/**
 * Was hat sich an einer Buchung geändert? Reine Funktionen für Buchende (Verwaltungslink) und
 * Veranstalter*innen gleichermaßen: Grundlage für das Audit-Log (Tische als stabiler key), die
 * Gegenüberstellung alt -> neu in der Änderungsmail und die Frage, ob die Kalenderdatei eine neue
 * SEQUENCE braucht.
 */

export type BookingSnapshot = { name: string; phone: string | null; note: string | null; partySize: number; tableKey: string | null }

export type ChangeField = 'name' | 'phone' | 'note' | 'partySize' | 'table'
export type Change = { field: ChangeField; from: string | number | null; to: string | number | null }

export const CHANGE_LABELS: Record<ChangeField, string> = {
  name: 'Name', phone: 'Telefon', note: 'Anmerkung', partySize: 'Personenzahl', table: 'Tisch'
}

export function diffBooking(before: BookingSnapshot, after: BookingSnapshot): Change[] {
  const changes: Change[] = []
  const track = (field: ChangeField, from: string | number | null, to: string | number | null) => {
    if (from !== to) changes.push({ field, from, to })
  }
  track('name', before.name, after.name)
  track('phone', before.phone, after.phone)
  track('note', before.note, after.note)
  track('partySize', before.partySize, after.partySize)
  track('table', before.tableKey, after.tableKey)
  return changes
}

/**
 * Name, Telefon und Anmerkung stehen nicht in der Kalenderdatei - nur Personenzahl und Tisch zählen
 * die SEQUENCE hoch (Konzept Abschnitt 7).
 */
export function calendarRelevant(changes: readonly Change[]): boolean {
  return changes.some(change => change.field === 'partySize' || change.field === 'table')
}

/** Für AuditLog.diff: { feld: { from, to } }. */
export function auditDiff(changes: readonly Change[]): Record<string, { from: string | number | null; to: string | number | null }> {
  return Object.fromEntries(changes.map(change => [change.field, { from: change.from, to: change.to }]))
}

export function changeLabels(changes: readonly Change[]): string[] {
  return changes.map(change => CHANGE_LABELS[change.field])
}

/** Zeilen "Tisch: Tisch 1 → Tisch 3" für die Änderungsmail. tableLabel übersetzt keys in Beschriftungen. */
export function changeRows(changes: readonly Change[], tableLabel: (key: string) => string): [string, string][] {
  const show = (change: Change, value: string | number | null) => {
    if (value === null || value === '') return '–'
    return change.field === 'table' ? tableLabel(String(value)) : String(value)
  }
  return changes.map(change => [CHANGE_LABELS[change.field], `${show(change, change.from)} → ${show(change, change.to)}`])
}
