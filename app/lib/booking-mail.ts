// app/lib/booking-mail.ts
import type { Event } from '@prisma/client'
import { baseUrl } from './base-url'
import { isMailConfigured, sendMail, type MailAttachment } from './mail'
import { broadcastBlocks, detailRows, renderHtml, renderText, type Block } from './mail-blocks'
import { prisma } from './prisma'
import { buildIcs } from './ics'
import { formatDateTime, formatRange } from './timezone'
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
  | 'waitlist-verify' | 'waitlist-confirmed' | 'offer' | 'offer-expired'

type MailEvent = Pick<Event, 'id' | 'slug' | 'title' | 'location' | 'startsAt' | 'endsAt' | 'timezone' | 'replyTo' | 'mailNote' | 'selfEditHoursBefore' | 'offerTtlHours' | 'mode'>

/** Modus SEAT spricht von Plätzen statt von einem Tisch. */
function seats(event: Pick<Event, 'mode'>): boolean {
  return event.mode === 'SEAT'
}
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
    { kind: 'p', text: `${tableLabel} ist bis ${formatDateTime(expiresAt, event.timezone)} für dich reserviert. Bitte bestätige deine E-Mail-Adresse, damit die Buchung gilt – sonst ${seats(event) ? 'werden die Plätze' : 'wird der Tisch'} danach wieder frei.` },
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
    { kind: 'p', text: `${byAdmin ? 'Die Veranstalter*innen haben deine Buchung storniert' : 'Deine Buchung wurde storniert'}, ${seats(event) ? 'die Plätze sind' : 'der Tisch ist'} wieder frei.` },
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
    broadcastBlocks(event, sample, seats(event) ? 'Reihe A, Plätze 1–4' : 'Tisch 1', content.body, `${baseUrl()}/b/beispiel/persoenlicher-link`))
}

// --- Warteliste (Konzept Abschnitt 5) ------------------------------------------------------------

function waitlistRows(event: MailEvent, booking: MailBooking): Block {
  return {
    kind: 'rows',
    rows: [
      ['Veranstaltung', event.title],
      ['Wann', formatRange(event.startsAt, event.endsAt, event.timezone)],
      ['Personen', String(booking.partySize)],
      ['Name', booking.name]
    ]
  }
}

export async function sendWaitlistVerifyMail(event: MailEvent, booking: MailBooking, token: string, code: string, expiresAt: Date) {
  return deliver(event, booking.id, 'waitlist-verify', booking.email, `Bitte bestätige deinen Eintrag auf der Warteliste – ${event.title}`, 'Bitte bestätige deinen Eintrag auf der Warteliste', [
    { kind: 'p', text: `Bitte bestätige deine E-Mail-Adresse bis ${formatDateTime(expiresAt, event.timezone)}. Erst dann stehst du auf der Warteliste.` },
    waitlistRows(event, booking),
    { kind: 'button', label: 'Eintrag bestätigen', href: verifyUrl(booking.id, token) },
    { kind: 'p', text: `Oder gib auf der Seite der Veranstaltung diesen Code ein: ${code}` },
    { kind: 'small', text: 'Falls du dich nicht eingetragen hast, ignoriere diese Mail einfach – der Eintrag verfällt dann von selbst.' }
  ])
}

export async function sendWaitlistConfirmedMail(event: MailEvent, booking: MailBooking) {
  return deliver(event, booking.id, 'waitlist-confirmed', booking.email, `Du stehst auf der Warteliste – ${event.title}`, 'Du stehst auf der Warteliste', [
    { kind: 'p', text: `${seats(event) ? 'Werden passende Plätze nebeneinander frei' : 'Wird ein passender Tisch frei'}, bekommst du ein Angebot per Mail. Es gilt ${event.offerTtlHours} ${event.offerTtlHours === 1 ? 'Stunde' : 'Stunden'} (höchstens bis Buchungsschluss) – nimmst du es in dieser Zeit nicht an, geht das Angebot an die nächste Gruppe.` },
    waitlistRows(event, booking),
    { kind: 'button', label: 'Eintrag ansehen oder zurückziehen', href: manageUrl(booking) },
    { kind: 'small', text: 'Der Link ist dein persönlicher Zugang – gib ihn nicht weiter. Über ihn nimmst du später auch ein Angebot an.' }
  ])
}

export async function sendOfferMail(event: MailEvent, booking: MailBooking, tableLabel: string, expiresAt: Date, logId?: string) {
  const heading = seats(event) ? 'Plätze sind für euch frei' : 'Ein Tisch ist für euch frei'
  const freed = seats(event) ? `Plätze nebeneinander sind frei geworden (${tableLabel}). Wir halten sie` : `${tableLabel} ist frei geworden und passt zu eurer Gruppe. Wir halten ihn`
  return deliver(event, booking.id, 'offer', booking.email, `${heading} – ${event.title}`, heading, [
    { kind: 'p', text: `Gute Nachricht: ${freed} bis ${formatDateTime(expiresAt, event.timezone)} für euch frei – bitte nimm das Angebot bis dahin an oder lehne es ab.` },
    detailRows(event, booking, tableLabel),
    { kind: 'button', label: 'Angebot ansehen und annehmen', href: manageUrl(booking) },
    { kind: 'small', text: 'Nimmst du das Angebot nicht rechtzeitig an, verfällt es und geht an die nächste Gruppe auf der Warteliste.' }
  ], { logId })
}

export async function sendOfferExpiredMail(event: MailEvent, booking: MailBooking, logId?: string) {
  return deliver(event, booking.id, 'offer-expired', booking.email, `Angebot verfallen – ${event.title}`, 'Dein Angebot ist verfallen', [
    { kind: 'p', text: 'Du hast das Angebot nicht rechtzeitig angenommen, es geht an die nächste Gruppe. Dein Eintrag auf der Warteliste ist damit beendet.' },
    waitlistRows(event, booking),
    { kind: 'button', label: 'Zur Veranstaltung', href: `${baseUrl()}/${event.slug}` },
    { kind: 'small', text: 'Du kannst dich auf der Seite der Veranstaltung erneut eintragen, solange noch gebucht werden kann.' }
  ], { logId })
}

/** Hat diese Buchung schon einen Verwaltungslink bekommen (und darf ihn deshalb erneut sehen)? */
export function hasManageLink(booking: { status: string; emailVerifiedAt: Date | null; source: string }): boolean {
  if (booking.status === 'CONFIRMED' || booking.status === 'OFFERED') return true
  return booking.status === 'WAITLISTED' && booking.emailVerifiedAt !== null
}

/**
 * Für diese Adresse gibt es schon eine aktive Buchung oder einen Eintrag auf der Warteliste
 * (oneBookingPerEmail). Die Seite antwortet wie bei Erfolg und verrät nichts - die Information geht
 * nur an die Adresse.
 */
export async function sendAlreadyBookedMail(event: MailEvent, existing: MailBooking & { status: string; emailVerifiedAt: Date | null; source: string }) {
  const linked = hasManageLink(existing)
  return deliver(event, existing.id, 'already-booked', existing.email, `Deine Buchung – ${event.title}`, 'Du hast bereits gebucht', [
    { kind: 'p', text: `Mit dieser E-Mail-Adresse wurde gerade versucht, für „${event.title}“ noch einmal zu buchen oder sich auf die Warteliste zu setzen. Pro Adresse ist nur eine Buchung bzw. ein Eintrag möglich – es wurde deshalb nichts angelegt.` },
    ...(linked
      ? [{ kind: 'button' as const, label: existing.status === 'WAITLISTED' ? 'Bestehenden Eintrag ansehen' : 'Bestehende Buchung ansehen oder ändern', href: manageUrl(existing) }]
      : [{ kind: 'p' as const, text: 'Deine bisherige Reservierung bzw. dein Eintrag ist noch nicht bestätigt. Bestätige ihn mit dem Link oder Code aus der früheren Mail. Läuft die Frist ab, kannst du es neu versuchen.' }]),
    { kind: 'small', text: 'Warst du das nicht, kannst du diese Mail ignorieren.' }
  ])
}

/** Buchen ist nur mit Mailversand und gesetzten Secrets möglich - sonst kein unsicherer Rückfall. */
export function bookingAvailable(): boolean {
  return isMailConfigured() && bookingSecretsConfigured()
}
