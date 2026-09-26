// app/lib/booking-mail.ts
import type { Event } from '@prisma/client'
import { baseUrl } from './base-url'
import { isMailConfigured, sendMail, type MailAttachment } from './mail'
import { broadcastBlocks, detailRows, renderHtml, renderText, type Block } from './mail-blocks'
import { prisma } from './prisma'
import { buildIcs } from './ics'
import { formatDateTime } from './timezone'
import { bookingSecretsConfigured, manageToken } from './booking-tokens'
import { selfEditDeadline } from './events/booking-rules'

/**
 * Mails an Buchende (docs/KONZEPT.md Abschnitt 7). Jede Mail außer der Verifizierung enthält den
 * persönlichen Verwaltungslink; jede wird im MailLog protokolliert (auch gescheiterte).
 * Aufbau und Maskierung: app/lib/mail-blocks.ts.
 *
 * Buchungen ohne E-Mail-Adresse (vom Admin angelegt, z.B. telefonisch) bekommen keine Mails - die
 * Funktionen geben dann false zurück, ohne etwas zu protokollieren.
 */

export type MailType =
  | 'verify' | 'confirmed' | 'changed' | 'admin-changed' | 'cancelled' | 'already-booked' | 'manage-link' | 'broadcast' | 'broadcast-test'

type MailEvent = Pick<Event, 'id' | 'slug' | 'title' | 'location' | 'startsAt' | 'endsAt' | 'timezone' | 'replyTo' | 'mailNote' | 'selfEditHoursBefore'>
type MailBooking = { id: string; name: string; email: string | null; partySize: number; manageTokenVersion: number; icsSequence: number }

export function manageUrl(booking: { id: string; manageTokenVersion: number }): string {
  return `${baseUrl()}/b/${booking.id}/${manageToken(booking.id, booking.manageTokenVersion)}`
}

export function verifyUrl(bookingId: string, token: string): string {
  return `${baseUrl()}/verify/${bookingId}/${token}`
}

/**
 * Verschickt und protokolliert. logId: bestehende MailLog-Zeile (Rundmail-Warteschlange) statt einer
 * neuen aktualisieren.
 */
async function deliver(
  event: MailEvent, bookingId: string | null, type: MailType, to: string | null, subject: string, heading: string, blocks: Block[],
  options: { attachments?: MailAttachment[]; logId?: string } = {}
) {
  if (!to) return false
  const result = await sendMail(to, subject, renderText(blocks), renderHtml(heading, blocks), { replyTo: event.replyTo, attachments: options.attachments })
  const log = { status: result.ok ? 'sent' : 'failed', error: result.ok ? null : result.error }
  if (options.logId) await prisma.mailLog.update({ where: { id: options.logId }, data: log })
  else await prisma.mailLog.create({ data: { eventId: event.id, bookingId, type, recipient: to, ...log } })
  return result.ok
}

function ics(event: MailEvent, booking: MailBooking, tableLabel: string, method: 'PUBLISH' | 'CANCEL'): MailAttachment {
  const link = manageUrl(booking)
  const content = buildIcs({
    method,
    uid: `booking-${booking.id}@${new URL(baseUrl()).hostname}`,
    sequence: booking.icsSequence,
    start: event.startsAt,
    end: event.endsAt,
    stamp: new Date(),
    summary: event.title,
    location: event.location || undefined,
    description: method === 'CANCEL'
      ? `Deine Buchung (${tableLabel}) wurde storniert.`
      : `${tableLabel} · ${booking.partySize} ${booking.partySize === 1 ? 'Person' : 'Personen'}\nBuchung ansehen oder ändern: ${link}`,
    url: method === 'CANCEL' ? undefined : link
  })
  return { filename: `${event.slug}.ics`, content, contentType: `text/calendar; charset=utf-8; method=${method}` }
}

const CALENDAR_HINT = 'Im Anhang findest du einen Kalendereintrag. Nicht jeder Kalender übernimmt spätere Änderungen zuverlässig – maßgeblich ist immer deine Buchungsseite.'

function deadlineText(event: MailEvent): string {
  return `Ändern oder stornieren kannst du bis ${formatDateTime(selfEditDeadline(event), event.timezone)}. Danach wende dich bitte an die Veranstalter*innen.`
}

export async function sendVerifyMail(event: MailEvent, booking: MailBooking, tableLabel: string, token: string, code: string, expiresAt: Date) {
  return deliver(event, booking.id, 'verify', booking.email, `Bitte bestätige deine Reservierung – ${event.title}`, 'Bitte bestätige deine Reservierung', [
    { kind: 'p', text: `${tableLabel} ist bis ${formatDateTime(expiresAt, event.timezone)} für dich reserviert. Bitte bestätige deine E-Mail-Adresse, damit die Buchung gilt – sonst wird der Tisch danach wieder frei.` },
    detailRows(event, booking, tableLabel),
    { kind: 'button', label: 'Buchung bestätigen', href: verifyUrl(booking.id, token) },
    { kind: 'p', text: `Oder gib auf der Buchungsseite diesen Code ein: ${code}` },
    { kind: 'small', text: 'Falls du nichts gebucht hast, ignoriere diese Mail einfach – die Reservierung verfällt dann von selbst.' }
  ])
}

export async function sendConfirmedMail(event: MailEvent, booking: MailBooking, tableLabel: string) {
  return deliver(event, booking.id, 'confirmed', booking.email, `Buchung bestätigt – ${event.title}`, 'Deine Buchung ist bestätigt', [
    { kind: 'p', text: 'Vielen Dank – deine Buchung ist bestätigt.' },
    detailRows(event, booking, tableLabel),
    ...(event.mailNote ? [{ kind: 'p' as const, text: event.mailNote }] : []),
    { kind: 'button', label: 'Buchung ansehen oder ändern', href: manageUrl(booking) },
    { kind: 'p', text: deadlineText(event) },
    { kind: 'small', text: `${CALENDAR_HINT} Bewahre diese Mail auf: Der Link ist dein persönlicher Zugang zur Buchung – gib ihn nicht weiter.` }
  ], { attachments: [ics(event, booking, tableLabel, 'PUBLISH')] })
}

/**
 * Änderung durch die Kund*in selbst oder durch Veranstalter*innen (byAdmin) - mit Gegenüberstellung
 * alt -> neu (rows aus app/lib/events/booking-changes.ts) und aktualisierter Kalenderdatei.
 */
export async function sendChangedMail(event: MailEvent, booking: MailBooking, tableLabel: string, labels: string[], rows: [string, string][], byAdmin = false) {
  const heading = byAdmin ? 'Die Veranstalter*innen haben deine Buchung geändert' : 'Deine Buchung wurde geändert'
  return deliver(event, booking.id, byAdmin ? 'admin-changed' : 'changed', booking.email, `Buchung geändert – ${event.title}`, heading, [
    { kind: 'p', text: `Geändert: ${labels.join(', ')}.` },
    { kind: 'rows', rows },
    { kind: 'p', text: 'So sieht deine Buchung jetzt aus:' },
    detailRows(event, booking, tableLabel),
    { kind: 'button', label: 'Buchung ansehen oder ändern', href: manageUrl(booking) },
    { kind: 'p', text: deadlineText(event) },
    { kind: 'small', text: CALENDAR_HINT }
  ], { attachments: [ics(event, booking, tableLabel, 'PUBLISH')] })
}

export async function sendCancelledMail(event: MailEvent, booking: MailBooking, tableLabel: string, byAdmin = false) {
  return deliver(event, booking.id, 'cancelled', booking.email, `Buchung storniert – ${event.title}`, 'Deine Buchung wurde storniert', [
    { kind: 'p', text: byAdmin ? 'Die Veranstalter*innen haben deine Buchung storniert, der Tisch ist wieder frei.' : 'Deine Buchung wurde storniert, der Tisch ist wieder frei.' },
    detailRows(event, booking, tableLabel),
    ...(byAdmin ? [{ kind: 'p' as const, text: 'Bei Fragen antworte einfach auf diese Mail.' }] : []),
    { kind: 'small', text: 'Im Anhang findest du eine Kalenderdatei, die den Eintrag in deinem Kalender entfernt (sofern dein Kalender das unterstützt).' }
  ], { attachments: [ics(event, booking, tableLabel, 'CANCEL')] })
}

/** Neuer Verwaltungslink (Admin hat den alten ungültig gemacht). */
export async function sendManageLinkMail(event: MailEvent, booking: MailBooking, tableLabel: string) {
  return deliver(event, booking.id, 'manage-link', booking.email, `Neuer Link zu deiner Buchung – ${event.title}`, 'Neuer Link zu deiner Buchung', [
    { kind: 'p', text: 'Die Veranstalter*innen haben den Link zu deiner Buchung erneuert. Der bisherige Link – auch der in einem früheren Kalendereintrag – funktioniert nicht mehr.' },
    detailRows(event, booking, tableLabel),
    { kind: 'button', label: 'Buchung ansehen oder ändern', href: manageUrl(booking) },
    { kind: 'small', text: `${CALENDAR_HINT} Der Link ist dein persönlicher Zugang zur Buchung – gib ihn nicht weiter.` }
  ], { attachments: [ics(event, booking, tableLabel, 'PUBLISH')] })
}

/**
 * Eine Mail einer Rundmail (Warteschlange, app/lib/events/broadcast.ts). Den Verwaltungslink und die
 * Kalenderdatei bekommen nur bestätigte Buchungen.
 */
export async function sendBroadcastMail(
  event: MailEvent, booking: MailBooking & { status: string }, tableLabel: string,
  content: { subject: string; body: string; includeIcs: boolean }, logId: string
) {
  const confirmed = booking.status === 'CONFIRMED'
  return deliver(event, booking.id, 'broadcast', booking.email, content.subject, event.title,
    broadcastBlocks(event, booking, tableLabel, content.body, confirmed ? manageUrl(booking) : null),
    { logId, attachments: confirmed && content.includeIcs ? [ics(event, booking, tableLabel, 'PUBLISH')] : undefined })
}

/** Testversand einer Rundmail an das eigene Konto - mit Beispieldaten statt einer echten Buchung. */
export async function sendBroadcastTestMail(event: MailEvent, to: string, content: { subject: string; body: string }) {
  const sample = { name: 'Erika Beispiel', partySize: 4 }
  return deliver(event, null, 'broadcast-test', to, `[Test] ${content.subject}`, event.title,
    broadcastBlocks(event, sample, 'Tisch 1', content.body, `${baseUrl()}/b/beispiel/persoenlicher-link`))
}

/**
 * Für diese Adresse gibt es schon eine aktive Buchung (oneBookingPerEmail). Die Seite antwortet
 * wie bei einer neuen Reservierung und verrät nichts - die Information geht nur an die Adresse.
 */
export async function sendAlreadyBookedMail(event: MailEvent, existing: MailBooking & { status: string }) {
  const confirmed = existing.status === 'CONFIRMED'
  return deliver(event, existing.id, 'already-booked', existing.email, `Deine Buchung – ${event.title}`, 'Du hast bereits gebucht', [
    { kind: 'p', text: `Mit dieser E-Mail-Adresse wurde gerade versucht, für „${event.title}“ noch einmal zu buchen. Pro Adresse ist nur eine Buchung möglich – es wurde deshalb nichts reserviert.` },
    ...(confirmed
      ? [{ kind: 'button' as const, label: 'Bestehende Buchung ansehen oder ändern', href: manageUrl(existing) }]
      : [{ kind: 'p' as const, text: 'Deine bisherige Reservierung ist noch nicht bestätigt. Bestätige sie mit dem Link oder Code aus der früheren Mail. Läuft sie ab, kannst du neu buchen.' }]),
    { kind: 'small', text: 'Warst du das nicht, kannst du diese Mail ignorieren.' }
  ])
}

/** Buchen ist nur mit Mailversand und gesetzten Secrets möglich - sonst kein unsicherer Rückfall. */
export function bookingAvailable(): boolean {
  return isMailConfigured() && bookingSecretsConfigured()
}
