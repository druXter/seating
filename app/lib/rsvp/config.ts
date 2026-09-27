// app/lib/rsvp/config.ts
import { baseUrl } from '../base-url'
import { originOf } from './token'

/**
 * Konfiguration der Anbindung an rsvp-app (Phase 7). Optional: Ohne RSVP_SEATING_SECRET (mindestens 32
 * Zeichen, auf beiden Seiten identisch) oder ohne RSVP_APP_BASE_URL ist die Anbindung aus - der Zugang
 * "nur mit Zusage" lässt sich dann nicht wählen, eingehende Nachrichten werden abgelehnt.
 */

const MIN_SECRET_LENGTH = 32

export function rsvpSecret(): string | null {
  const value = process.env.RSVP_SEATING_SECRET
  return value && value.length >= MIN_SECRET_LENGTH ? value : null
}

/** Origin von rsvp-app - Empfänger (aud) der Nachrichten von Seating und Ziel der Anfragen. */
export function rsvpAppOrigin(): string | null {
  return originOf(process.env.RSVP_APP_BASE_URL)
}

/** Origin von Seating - Empfänger (aud) der Nachrichten von rsvp-app. */
export function seatingOrigin(): string {
  return originOf(baseUrl()) ?? baseUrl()
}

export function rsvpConfigured(): boolean {
  return rsvpSecret() !== null && rsvpAppOrigin() !== null
}

/** Der Link, den die Besitzer*in des rsvp-Events dort als "Sitzplatz-Link" einträgt. */
export function seatingLinkFor(eventId: string): string {
  return `${seatingOrigin()}/rsvp/${eventId}`
}
