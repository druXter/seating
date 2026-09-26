// app/lib/mail-blocks.ts
import { APP_NAME } from './app'
import { formatRange } from './timezone'

/**
 * Aufbau der Buchungsmails aus einfachen Bausteinen, gerendert als HTML und Klartext. Ohne Server-
 * Abhängigkeiten, damit die Rundmail-Vorschau im Browser genau denselben Text zeigt wie die Mail
 * (app/admin/events/[id]/mail). Alle frei wählbaren Texte werden im HTML-Teil maskiert.
 */

/** Maskiert Text für die Verwendung in HTML (Mail-Inhalte enthalten u.a. frei wählbare Namen/Titel). */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'rows'; rows: [string, string][] }
  | { kind: 'button'; label: string; href: string }
  | { kind: 'small'; text: string }

export function renderHtml(heading: string, blocks: Block[]): string {
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

function renderBlocksText(blocks: Block[]): string {
  return blocks.map(block => {
    switch (block.kind) {
      case 'p': case 'small': return block.text
      case 'rows': return block.rows.map(([k, v]) => `${k}: ${v}`).join('\n')
      case 'button': return `${block.label}:\n${block.href}`
    }
  }).join('\n\n')
}

/** Klartext-Teil mit Anrede und Signatur. */
export function renderText(blocks: Block[]): string {
  return `Hallo,\n\n${renderBlocksText(blocks)}\n\n-- \n${APP_NAME}`
}

export type DetailsEvent = { title: string; location: string; startsAt: Date; endsAt: Date; timezone: string }
export type DetailsBooking = { name: string; partySize: number }

export function detailRows(event: DetailsEvent, booking: DetailsBooking, tableLabel: string): Block {
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
