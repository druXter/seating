// app/admin/events/[id]/arrange/guest-import-form.tsx
'use client'

import { buttonClass, inputClass, labelClass, Notice } from '../../../../ui/kit'
import { useActionState } from 'react'
import { importGuestsAction, type ImportState } from '../../arrange-actions'

/**
 * Gästeliste per CSV (Konzept Abschnitt 8): erst prüfen und Vorschau zeigen, dann übernehmen. Die
 * Vorschau trägt den Text der Datei weiter (verstecktes Feld); der Server prüft ihn beim Übernehmen
 * erneut.
 */
export default function GuestImportForm({ eventId }: { eventId: string }) {
  const [state, dispatch, pending] = useActionState<ImportState, FormData>(importGuestsAction, null)
  const preview = state?.preview

  return (
    <div className="space-y-3">
      {state && state.errors.length > 0 && (
        <Notice tone="error"><ul className="list-disc list-inside">{state.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>
      )}
      {state?.message && <Notice tone="success">{state.message}</Notice>}

      {preview ? (
        <form action={dispatch} className="space-y-3">
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="confirm" value="1" />
          <textarea name="csv" defaultValue={preview.csv} hidden readOnly />
          <p className="text-sm font-medium" data-testid="import-preview">
            Vorschau: {preview.parties.length} {preview.parties.length === 1 ? 'Gruppe' : 'Gruppen'} mit {preview.persons} {preview.persons === 1 ? 'Person' : 'Personen'}
          </p>
          <ul className="text-sm max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y">
            {preview.parties.slice(0, 200).map((party, i) => (
              <li key={i} className="px-2 py-1">
                <span className="font-medium">{party.name}</span>
                {(party.persons.length > 1 || party.persons[0] !== party.name) && <span className="text-gray-600 dark:text-gray-400">: {party.persons.join(', ')}</span>}
                {party.note && <span className="block text-xs text-purple-800 dark:text-purple-200">{party.note}</span>}
              </li>
            ))}
            {preview.parties.length > 200 && <li className="px-2 py-1 text-gray-600 dark:text-gray-400">… und {preview.parties.length - 200} weitere</li>}
          </ul>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={buttonClass('primary')}>Übernehmen</button>
            {/* Neu laden setzt den Zustand zurück (Vorschau verwerfen). */}
            <button type="button" onClick={() => window.location.reload()} className={buttonClass('secondary')}>Verwerfen</button>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">Übernehmen ergänzt die Gästeliste – vorhandene Gäste bleiben, wie sie sind.</p>
        </form>
      ) : (
        <form action={dispatch} className="space-y-3">
          <input type="hidden" name="eventId" value={eventId} />
          <div>
            <label htmlFor="import-file" className={labelClass}>CSV-Datei</label>
            <input id="import-file" name="file" type="file" accept=".csv,text/csv,text/plain" className="text-sm" />
          </div>
          <div>
            <label htmlFor="import-csv" className={labelClass}>… oder Liste einfügen</label>
            <textarea id="import-csv" name="csv" rows={5} className={inputClass} placeholder={'Name;Gruppe;Notiz\nErika Muster;Familie Muster;vegetarisch\nMax Muster;Familie Muster;'} />
          </div>
          <button type="submit" disabled={pending} className={buttonClass('secondary')}>Prüfen</button>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Eine Zeile pro Person, erste Zeile mit Spaltennamen: „Name“ (Pflicht), dazu optional „Gruppe“ (gleiche Gruppe = sitzen
            zusammen) und „Notiz“ (interne Notiz der Gruppe). Trenner Semikolon oder Komma, UTF-8 – so speichern Excel und
            LibreOffice als „CSV UTF-8“.
          </p>
        </form>
      )}
    </div>
  )
}
