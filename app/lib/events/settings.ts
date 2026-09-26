// app/lib/events/settings.ts
import type { EventMode, EventStatus } from '@prisma/client'
import { formString } from '../form'
import { validateSlug } from '../slugs'
import { DEFAULT_TIMEZONE, zonedInputToUtc } from '../timezone'

export const EVENT_LIMITS = { title: 200, location: 200, description: 5000 } as const

export const STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Entwurf',
  OPEN: 'Veröffentlicht',
  CLOSED: 'Geschlossen',
  ARCHIVED: 'Archiviert'
}

export const STATUS_HINTS: Record<EventStatus, string> = {
  DRAFT: 'nicht öffentlich – nur Konten mit Zugriff sehen eine Vorschau',
  OPEN: 'öffentlich sichtbar',
  CLOSED: 'öffentlich sichtbar, Buchung geschlossen',
  ARCHIVED: 'nicht mehr öffentlich'
}

export const MODE_LABELS: Record<EventMode, string> = {
  TABLE: 'Tischbuchung für Gruppen',
  SEAT: 'Einzelplätze (Kino, Ball)',
  ASSIGNED: 'Sitzordnung durch Veranstalter*innen'
}

/** Modi, die die Oberfläche schon anbietet (SEAT folgt mit Phase 5, ASSIGNED mit Phase 6). */
export const AVAILABLE_MODES: readonly EventMode[] = ['TABLE']

const STATUSES: readonly EventStatus[] = ['DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED']

export type EventFields = {
  title: string
  slug: string
  description: string
  location: string
  startsAt: Date
  endsAt: Date
  mode: EventMode
  bookingOpensAt: Date | null
  bookingClosesAt: Date | null
  minFillRatio: number | null
}

export type ParsedEvent = { ok: true; fields: EventFields; status: EventStatus | null } | { ok: false; errors: string[] }

/** Zeilenumbrüche vereinheitlichen, Steuerzeichen (außer Umbruch/Tab) entfernen. */
function cleanText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

function optionalDate(formData: FormData, name: string, timeZone: string, label: string, errors: string[]): Date | null {
  const value = formString(formData, name, 20)
  if (!value) return null
  const date = zonedInputToUtc(value, timeZone)
  if (!date) errors.push(`${label}: kein gültiges Datum.`)
  return date
}

/**
 * Prüft das Event-Formular (Anlegen und Einstellungen) serverseitig. status ist null, wenn das
 * Formular kein Statusfeld hat (Anlegen: immer Entwurf).
 */
export function parseEventForm(formData: FormData, timeZone: string = DEFAULT_TIMEZONE): ParsedEvent {
  const errors: string[] = []

  const title = cleanText(formString(formData, 'title', EVENT_LIMITS.title)).replace(/\n/g, ' ')
  if (!title) errors.push('Bitte gib einen Titel an.')

  const slug = formString(formData, 'slug', 100).toLowerCase()
  const slugError = validateSlug(slug)
  if (slugError) errors.push(`Adresse: ${slugError}`)

  const description = cleanText(formString(formData, 'description', EVENT_LIMITS.description))
  const location = cleanText(formString(formData, 'location', EVENT_LIMITS.location)).replace(/\n/g, ' ')

  const startsAt = optionalDate(formData, 'startsAt', timeZone, 'Beginn', errors)
  const endsAt = optionalDate(formData, 'endsAt', timeZone, 'Ende', errors)
  if (!formString(formData, 'startsAt', 20)) errors.push('Bitte gib den Beginn an.')
  if (!formString(formData, 'endsAt', 20)) errors.push('Bitte gib das Ende an.')
  if (startsAt && endsAt && endsAt <= startsAt) errors.push('Das Ende muss nach dem Beginn liegen.')

  const bookingOpensAt = optionalDate(formData, 'bookingOpensAt', timeZone, 'Buchung ab', errors)
  const bookingClosesAt = optionalDate(formData, 'bookingClosesAt', timeZone, 'Buchung bis', errors)
  if (bookingOpensAt && bookingClosesAt && bookingClosesAt <= bookingOpensAt) {
    errors.push('Das Ende des Buchungszeitraums muss nach seinem Beginn liegen.')
  }

  const mode = (formString(formData, 'mode', 20) || 'TABLE') as EventMode
  if (!AVAILABLE_MODES.includes(mode)) errors.push('Dieser Modus steht noch nicht zur Verfügung.')

  let minFillRatio: number | null = null
  const minFill = formString(formData, 'minFillPercent', 10)
  if (minFill) {
    const percent = Number(minFill.replace(',', '.'))
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) errors.push('Mindestbelegung: eine ganze Zahl von 1 bis 100 (%), oder leer lassen.')
    else minFillRatio = percent / 100
  }

  let status: EventStatus | null = null
  if (formData.has('status')) {
    const value = formString(formData, 'status', 20) as EventStatus
    if (STATUSES.includes(value)) status = value
    else errors.push('Unbekannter Status.')
  }

  if (errors.length > 0 || !startsAt || !endsAt) return { ok: false, errors }
  return {
    ok: true,
    status,
    fields: { title, slug, description, location, startsAt, endsAt, mode, bookingOpensAt, bookingClosesAt, minFillRatio }
  }
}
