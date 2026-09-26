// app/lib/booking-mail.ts
import type { Event } from '@prisma/client'
import { APP_NAME } from './app'
import { baseUrl } from './base-url'
import { esc, isMailConfigured, sendMail, type MailAttachment } from './mail'
import { prisma } from './prisma'
import { buildIcs } from './ics'
import { formatDateTime, formatRange } from './timezone'
import { bookingSecretsConfigured, manageToken } from './booking-tokens'
import { selfEditDeadline } from './events/booking-rules'

/**
 * Mails an Buchende (docs/KONZEPT.md Abschnitt 7). Jede Mail außer der Verifizierung enthält den
 * persönlichen Verwaltungslink; jede wird im MailLog protokolliert (auch gescheiterte).
 * Alle frei wählbaren Texte (Titel, Namen, Hinweise) werden im HTML-Teil maskiert.
 */

export type MailType = 'verify' | 'confirmed' | 'changed' | 'cancelled' | 'already-booked'

type MailEvent = Pick<Event, 'id' | 'slug' | 'title' | 'location' | 'startsAt' | 'endsAt' | 'timezone' | 'replyTo' | 'mailNote' | 'selfEditHoursBefore'>
type MailBooking = { id: string; name: string; email: string; partySize: number; manageTokenVersion: number; icsSequence: number }

export function manageUrl(booking: { id: string; manageTokenVersion: number }): string {
  return `${baseUrl()}/b/${booking.id}/${manageToken(booking.id, booking.manageTokenVersion)}`
}

export function verifyUrl(bookingId: string, token: string): string {
  return `${baseUrl()}/verify/${bookingId}/${token}`
}

type Block = { kind: 'p'; text: string } | { kind: 'rows'; rows: [string, string][] } | { kind: 'button'; label: string; href: string } | { kind: 'small'; text: string }

function renderHtml(heading: string, blocks: Block[]): string {
  const body = blocks.map(block => {
    switch (block.kind) {
      case 'p': return `<p>${esc(block.text).replace(/\n/g, '<br>')}</p>`
      case 'small': return `<p style="font-size: 12px; color: #666;">${esc(block.text).replace(/\n/g, '<br>')}</p>`
      case 'rows': return `<table style="border-collapse: collapse; margin: 16px 0;">${block.rows.map(([k, v]) =>
        `<tr><td style="padding: 4px 12px 4px 0; color: #666; vertical-align: top;">${esc(k)}</td><td style="padding: 4px 0;">${esc(v)}</td></tr>`).join('')}</table>`
      case 'button': return `<p style="text-align: center; margin: 30px 0;"><a href="${esc(block.href)}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">${esc(block.label)}</a></p>
        <p style="font-size: 12px; color: #666;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${esc(block.href)}</p>`
    }
  }).join('\n')
  return `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;"><h2>${esc(heading)}</h2>${body}</div>`
}

function renderText(blocks: Block[]): string {
  return blocks.map(block => {
    switch (block.kind) {
      case 'p': case 'small': return block.text
      case 'rows': return block.rows.map(([k, v]) => `${k}: ${v}`).join('\n')
      case 'button': return `${block.label}:\n${block.href}`
    }
  }).join('\n\n')
}

async function deliver(event: MailEvent, bookingId: string | null, type: MailType, to: string, subject: string, heading: string, blocks: Block[], attachments?: MailAttachment[]) {
  const result = await sendMail(to, subject, `Hallo,\n\n${renderText(blocks)}\n\n-- \n${APP_NAME}`, renderHtml(heading, blocks), { replyTo: event.replyTo, attachments })
  await prisma.mailLog.create({
    data: { eventId: event.id, bookingId, type, recipient: to, status: result.ok ? 'sent' : 'failed', error: result.ok ? null : result.error }
  })
  return result.ok
}

function details(event: MailEvent, booking: MailBooking, tableLabel: string): Block {
  return {
    kind: 'rows',
    rows: [
      ['Veranstaltung', event.title],
      ['Wann', formatRange(event.startsAt, event.endsAt, event.timezone)],
      ...(event.location ? [['Wo', event.location] as [string, string]] : []),
      ['Tisch', tableLabel],
      ['Personen', String(booking.partySize)],
      ['Name', booking.name]
    ]
  }
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
    details(event, booking, tableLabel),
    { kind: 'button', label: 'Buchung bestätigen', href: verifyUrl(booking.id, token) },
    { kind: 'p', text: `Oder gib auf der Buchungsseite diesen Code ein: ${code}` },
    { kind: 'small', text: 'Falls du nichts gebucht hast, ignoriere diese Mail einfach – die Reservierung verfällt dann von selbst.' }
  ])
}

export async function sendConfirmedMail(event: MailEvent, booking: MailBooking, tableLabel: string) {
  return deliver(event, booking.id, 'confirmed', booking.email, `Buchung bestätigt – ${event.title}`, 'Deine Buchung ist bestätigt', [
    { kind: 'p', text: 'Vielen Dank – deine Buchung ist bestätigt.' },
    details(event, booking, tableLabel),
    ...(event.mailNote ? [{ kind: 'p' as const, text: event.mailNote }] : []),
    { kind: 'button', label: 'Buchung ansehen oder ändern', href: manageUrl(booking) },
    { kind: 'p', text: deadlineText(event) },
    { kind: 'small', text: `${CALENDAR_HINT} Bewahre diese Mail auf: Der Link ist dein persönlicher Zugang zur Buchung – gib ihn nicht weiter.` }
  ], [ics(event, booking, tableLabel, 'PUBLISH')])
}

export async function sendChangedMail(event: MailEvent, booking: MailBooking, tableLabel: string, changes: string[]) {
  return deliver(event, booking.id, 'changed', booking.email, `Buchung geändert – ${event.title}`, 'Deine Buchung wurde geändert', [
    { kind: 'p', text: `Geändert: ${changes.join(', ')}.` },
    details(event, booking, tableLabel),
    { kind: 'button', label: 'Buchung ansehen oder ändern', href: manageUrl(booking) },
    { kind: 'p', text: deadlineText(event) },
    { kind: 'small', text: CALENDAR_HINT }
  ], [ics(event, booking, tableLabel, 'PUBLISH')])
}

export async function sendCancelledMail(event: MailEvent, booking: MailBooking, tableLabel: string) {
  return deliver(event, booking.id, 'cancelled', booking.email, `Buchung storniert – ${event.title}`, 'Deine Buchung wurde storniert', [
    { kind: 'p', text: 'Deine Buchung wurde storniert, der Tisch ist wieder frei.' },
    details(event, booking, tableLabel),
    { kind: 'small', text: 'Im Anhang findest du eine Kalenderdatei, die den Eintrag in deinem Kalender entfernt (sofern dein Kalender das unterstützt).' }
  ], [ics(event, booking, tableLabel, 'CANCEL')])
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
