// app/admin/events/rsvp-actions.ts
'use server'

import { redirect } from 'next/navigation'
import { refresh } from 'next/cache'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { loadEventForUser } from '../../lib/events/store'
import { afterBookingChange } from '../../lib/events/waitlist'
import { applySync, syncPreview } from '../../lib/rsvp/sync'
import { reportPlacements } from '../../lib/rsvp/notify'
import { parseSyncKeys, type SyncItem } from '../../lib/rsvp/rules'

/**
 * Abgleich mit rsvp-app und Rückmeldung der Platzierungen (docs/KONZEPT.md Abschnitt 9). Jede Aktion
 * prüft selbst Konto, Zugriff auf das Event und dessen Verknüpfung. Übernommen wird nur, was die
 * Veranstalter*in in der Vorschau auswählt - und zwar gegen die frisch geholte Liste (app/lib/rsvp/sync.ts).
 */

export type SyncState = {
  errors: string[]
  message?: string
  preview?: { items: SyncItem[]; unbooked: number | null; guests: number }
} | null

async function linkedEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  return { user, event }
}

export async function rsvpSyncAction(_previous: SyncState, formData: FormData): Promise<SyncState> {
  const { user, event } = await linkedEvent(formData)
  if (!event.rsvpEventId) return { errors: ['Dieses Event ist mit keinem rsvp-app-Event verknüpft (siehe Einstellungen).'] }

  if (formString(formData, 'step', 10) !== 'apply') {
    const preview = await syncPreview(event)
    if (!preview.ok) return { errors: [preview.error] }
    return { errors: [], preview: { items: preview.items, unbooked: preview.unbooked, guests: preview.guests } }
  }

  const keys = parseSyncKeys(formData.getAll('item'))
  if (keys.size === 0) return { errors: ['Bitte wähle aus, was übernommen werden soll.'] }
  const result = await applySync(event, keys, user.id)
  if (!result.ok) return { errors: [result.error] }
  afterBookingChange(event.id)
  refresh()
  return {
    errors: [],
    message: `${result.applied} ${result.applied === 1 ? 'Änderung' : 'Änderungen'} übernommen.${result.skipped > 0 ? ` ${result.skipped} ließen sich nicht mehr anwenden (inzwischen erledigt oder geändert).` : ''}`
  }
}

export async function reportPlacementsAction(_previous: SyncState, formData: FormData): Promise<SyncState> {
  const { event } = await linkedEvent(formData)
  if (!event.rsvpEventId) return { errors: ['Dieses Event ist mit keinem rsvp-app-Event verknüpft (siehe Einstellungen).'] }
  const ok = await reportPlacements(event.id)
  return ok ? { errors: [], message: 'Platzierungen an rsvp-app gemeldet.' } : { errors: ['rsvp-app hat die Meldung nicht angenommen oder ist nicht erreichbar.'] }
}
