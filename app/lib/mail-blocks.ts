// app/lib/mail-blocks.ts
import { mailHtml, mailText, type Mail, type MailBlock } from 'suite-kit/web'
import { APP_NAME } from './app'
import { formatRange } from './timezone'

/**
 * Aufbau der Buchungsmails aus den Bausteinen der Suite (renderMail aus suite-kit/web, dieselbe Vorlage in allen
 * Tools), gerendert als HTML und Klartext. Ohne Server-Abhängigkeiten, damit die Rundmail-Vorschau im Browser genau
 * denselben Text zeigt wie die Mail (app/admin/events/[id]/mail). Die Bausteine escapen jeden Text selbst.
 */

export type Block = MailBlock

/** Marke im Kopf jeder Mail, wie in der Kopfzeile. */
export const MAIL_BRAND = { letter: 'S', name: APP_NAME }

function content(heading: string, blocks: Block[]): Mail {
  return { brand: MAIL_BRAND, heading, blocks: [{ kind: 'p', text: 'Hallo,' }, ...blocks] }
}

export function renderHtml(heading: string, blocks: Block[]): string {
  return mailHtml(content(heading, blocks))
}

/** Klartext-Teil mit Anrede und Signatur. */
export function renderText(blocks: Block[]): string {
  return mailText(content('', blocks))
}

/** mode: Modus SEAT nennt die Plätze statt eines Tisches. */
export type DetailsEvent = { title: string; location: string; startsAt: Date; endsAt: Date; timezone: string; mode?: string }
export type DetailsBooking = { name: string; partySize: number }

export function detailRows(event: DetailsEvent, booking: DetailsBooking, tableLabel: string): Block {
  return {
    kind: 'rows',
    rows: [
      ['Veranstaltung', event.title],
      ['Wann', formatRange(event.startsAt, event.endsAt, event.timezone)],
      ...(event.location ? [['Wo', event.location] as [string, string]] : []),
      [event.mode === 'SEAT' ? 'Plätze' : 'Tisch', tableLabel],
      ['Personen', String(booking.partySize)],
      ['Name', booking.name]
    ]
  }
}

/**
 * Rundmail: freier Text der Veranstalter*innen, darunter die eigene Buchung und - bei bestätigten
 * Buchungen - der persönliche Verwaltungslink. Jede*r bekommt eine eigene Mail (kein BCC).
 */
export function broadcastBlocks(event: DetailsEvent, booking: DetailsBooking, tableLabel: string, body: string, manageUrl: string | null): Block[] {
  return [
    { kind: 'p', text: body },
    detailRows(event, booking, tableLabel),
    ...(manageUrl ? [{ kind: 'button' as const, label: 'Buchung ansehen oder ändern', href: manageUrl }] : []),
    { kind: 'small', text: `Du bekommst diese Mail, weil du für „${event.title}“ gebucht hast.` }
  ]
}

export const BROADCAST_LIMITS = { subject: 150, body: 5000 } as const
