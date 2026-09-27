// app/admin/events/rsvp-sync-panel.tsx
'use client'

import { useActionState } from 'react'
import { reportPlacementsAction, rsvpSyncAction, type SyncState } from './rsvp-actions'
import type { SyncKind } from '../../lib/rsvp/rules'
import Notice from '../../ui/notice'

const KIND_LABELS: Record<SyncKind, string> = { new: 'Neue Zusagen', changed: 'Geändert', removed: 'Nicht mehr zugesagt' }

function Feedback({ state }: { state: SyncState }) {
  if (!state) return null
  return (
    <>
      {state.errors.length > 0 && <Notice tone="error"><ul className="list-disc list-inside">{state.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
      {state.message && <Notice tone="success">{state.message}</Notice>}
    </>
  )
}

/**
 * Abgleich mit rsvp-app (docs/KONZEPT.md Abschnitt 9): erst die Vorschau holen, dann Ausgewähltes
 * übernehmen. assigned: Sitzordnung (neue Gruppen, Namen, Begleitungen, Absagen - Absagen sind nicht
 * vorausgewählt); sonst Platzwahl über Zusagen (Absagen stornieren, Personenzahl übernehmen).
 */
export default function RsvpSyncPanel({ eventId, assigned, changedSince }: { eventId: string; assigned: boolean; changedSince: string | null }) {
  const [state, dispatch, pending] = useActionState(rsvpSyncAction, null)
  const [reportState, report, reporting] = useActionState(reportPlacementsAction, null)
  const preview = state?.preview

  return (
    <div className="space-y-3" data-testid="rsvp-sync">
      {changedSince && !preview && <Notice tone="info">rsvp-app hat seit dem letzten Abgleich Änderungen gemeldet ({changedSince}).</Notice>}
      <Feedback state={state} />
      {preview ? (
        <form action={dispatch} className="space-y-3">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="step" value="apply" />
          <p className="text-sm" data-testid="rsvp-sync-summary">
            {preview.guests} {preview.guests === 1 ? 'Zusage' : 'Zusagen'} in rsvp-app.
            {preview.unbooked !== null && ` ${preview.unbooked} davon ${preview.unbooked === 1 ? 'hat' : 'haben'} noch nicht gebucht.`}
            {preview.items.length === 0 && ' Alles ist auf dem aktuellen Stand.'}
          </p>
          {(['new', 'changed', 'removed'] as const).map(kind => {
            const items = preview.items.filter(i => i.kind === kind)
            if (items.length === 0) return null
            return (
              <fieldset key={kind} className="space-y-1">
                <legend className="text-sm font-bold">{KIND_LABELS[kind]} ({items.length})</legend>
                {items.map(item => (
                  <label key={item.key} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="item" value={item.key} defaultChecked={kind !== 'removed' || !assigned} className="mt-1" />
                    <span>{item.title}{item.details.length > 0 && <span className="block text-xs text-gray-600">{item.details.join(' · ')}</span>}</span>
                  </label>
                ))}
              </fieldset>
            )
          })}
          {preview.items.length > 0 && (
            <button type="submit" disabled={pending} className="bg-blue-600 text-white font-bold py-2 px-3 rounded hover:bg-blue-700 text-sm disabled:opacity-50">Ausgewählte übernehmen</button>
          )}
        </form>
      ) : (
        <form action={dispatch}>
          <input type="hidden" name="eventId" value={eventId} />
          <button type="submit" disabled={pending} className="bg-gray-100 border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-200 disabled:opacity-50">Mit rsvp-app abgleichen</button>
        </form>
      )}
      <p className="text-xs text-gray-600">
        {assigned
          ? 'Nichts wird still gelöscht: Neue Zusagen werden Gruppen, Absagen erst nach deiner Auswahl abgesagt.'
          : 'Absagen in rsvp-app stornieren die Buchung automatisch; der Abgleich holt nach, was dabei verloren ging.'}
      </p>
      <form action={report} className="space-y-2">
        <input type="hidden" name="eventId" value={eventId} />
        <Feedback state={reportState} />
        <button type="submit" disabled={reporting} className="text-sm text-blue-700 hover:underline disabled:opacity-50">Platzierungen erneut an rsvp-app melden</button>
      </form>
    </div>
  )
}
