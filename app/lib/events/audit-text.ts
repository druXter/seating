// app/lib/events/audit-text.ts
import { CHANGE_LABELS, type ChangeField } from './booking-changes'

/**
 * Lesbare Einträge des Audit-Logs (Konzept Abschnitt 8: "ich hatte doch Tisch 4"). Rein, damit ohne
 * Datenbank testbar - wer "actor" ist (Konto-E-Mail) und wie ein Tisch heute heißt, reicht die Seite herein.
 */

const ACTION_LABELS: Record<string, string> = {
  reserved: 'reserviert',
  confirmed: 'bestätigt',
  'verification-resent': 'Bestätigungsmail erneut geschickt',
  changed: 'geändert',
  cancelled: 'storniert',
  expired: 'verfallen',
  'mail-failed': 'Mailversand gescheitert, Reservierung freigegeben',
  created: 'angelegt',
  note: 'interne Notiz geändert',
  'email-corrected': 'E-Mail-Adresse korrigiert',
  'manage-link-renewed': 'Verwaltungslink neu erzeugt',
  deleted: 'Buchung endgültig gelöscht',
  broadcast: 'Rundmail verschickt',
  'waitlist-joined': 'auf die Warteliste eingetragen (unbestätigt)',
  'waitlist-confirmed': 'Eintrag auf der Warteliste bestätigt',
  offered: 'Tisch aus der Warteliste angeboten',
  'offer-accepted': 'Angebot angenommen',
  'offer-declined': 'Angebot abgelehnt',
  'waitlist-left': 'von der Warteliste ausgetragen',
  assigned: 'Tisch direkt zugewiesen (Warteliste)'
}

export type AuditEntry = { actor: string; action: string; diff: unknown; createdAt: Date }
export type AuditContext = { accountEmail: (id: string) => string | null; tableLabel: (key: string) => string }

export function actorText(actor: string, context: AuditContext): string {
  if (actor === 'customer') return 'Kund*in'
  if (actor === 'system') return 'System'
  return context.accountEmail(actor) ?? 'gelöschtes Konto'
}

function show(value: unknown, field: string, context: AuditContext): string {
  if (value === null || value === undefined || value === '') return '–'
  if (field === 'table' && typeof value === 'string') return context.tableLabel(value)
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Einzelheiten eines Eintrags, z.B. ["Tisch: Tisch 1 → Tisch 3", "Personenzahl: 4 → 6"]. */
export function auditDetails(entry: AuditEntry, context: AuditContext): string[] {
  const diff = isRecord(entry.diff) ? entry.diff : {}
  const details: string[] = []
  for (const [field, value] of Object.entries(diff)) {
    const label = CHANGE_LABELS[field as ChangeField] ?? { email: 'E-Mail', partySize: 'Personenzahl', subject: 'Betreff', recipients: 'Empfänger*innen' }[field] ?? null
    if (isRecord(value) && 'from' in value && 'to' in value) {
      details.push(`${label ?? field}: ${show(value.from, field, context)} → ${show(value.to, field, context)}`)
    } else if (field === 'renewedExpiry') {
      if (value === true) details.push('Frist neu begonnen')
    } else if (field === 'notified') {
      details.push(value === true ? 'Kund*in benachrichtigt' : 'ohne Mail')
    } else if (label) {
      details.push(`${label}: ${show(value, field, context)}`)
    }
  }
  return details
}

export function auditText(entry: AuditEntry): string {
  return ACTION_LABELS[entry.action] ?? entry.action
}
