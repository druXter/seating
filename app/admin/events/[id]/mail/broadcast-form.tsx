// app/admin/events/[id]/mail/broadcast-form.tsx
'use client'

import { useActionState, useState } from 'react'
import { sendBroadcast, sendBroadcastTest, type BookingFormState } from '../../booking-actions'
import { BROADCAST_LIMITS, broadcastBlocks, renderText, type DetailsEvent } from '../../../../lib/mail-blocks'
import Notice from '../../../../ui/notice'

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'

export type BroadcastRecipient = { status: 'CONFIRMED' | 'PENDING'; tableKeys: string[] }

function Feedback({ state }: { state: BookingFormState }) {
  if (!state) return null
  return (
    <>
      {state.errors.length > 0 && <Notice tone="error"><ul className="list-disc list-inside">{state.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
      {state.message && <Notice tone="success">{state.message}</Notice>}
    </>
  )
}

/**
 * Rundmail schreiben: Empfänger filtern (die Zahl rechnet der Browser mit, dieselbe Regel prüft der
 * Server beim Absenden erneut), Vorschau des Klartexts mit Beispieldaten, Testversand an sich selbst.
 * Die Liste der Empfänger*innen enthält bewusst nur Status und Tische, keine Namen oder Adressen.
 */
export default function BroadcastForm({ eventId, event, recipients, tables }: {
  eventId: string
  event: DetailsEvent
  recipients: BroadcastRecipient[]
  tables: { key: string; label: string }[]
}) {
  const [sendState, send, sending] = useActionState(sendBroadcast, null)
  const [testState, test, testing] = useActionState(sendBroadcastTest, null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scope, setScope] = useState<'confirmed' | 'active'>('confirmed')
  const [onlyTables, setOnlyTables] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const count = recipients.filter(r =>
    (r.status === 'CONFIRMED' || scope === 'active') && (!onlyTables || r.tableKeys.some(key => selected.has(key)))
  ).length
  const preview = renderText(broadcastBlocks(event, { name: 'Erika Beispiel', partySize: 4 }, event.mode === 'SEAT' ? 'Reihe A, Plätze 1–4' : 'Tisch 1', body || '(dein Text)', '…/b/persoenlicher-link'))

  return (
    <form action={send} className="space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <Feedback state={sendState} />
      <Feedback state={testState} />
      <fieldset disabled={sending || testing} className="space-y-3">
        <div>
          <label htmlFor="broadcast-subject" className={labelClass}>Betreff</label>
          <input id="broadcast-subject" name="subject" required maxLength={BROADCAST_LIMITS.subject} value={subject} onChange={e => setSubject(e.currentTarget.value)} className={input} />
        </div>
        <div>
          <label htmlFor="broadcast-body" className={labelClass}>Text</label>
          <textarea id="broadcast-body" name="body" required maxLength={BROADCAST_LIMITS.body} rows={8} value={body} onChange={e => setBody(e.currentTarget.value)} className={input} />
          <p className="text-xs text-gray-600 mt-1">Anrede, die Daten der jeweiligen Buchung und der persönliche Link werden automatisch ergänzt.</p>
        </div>

        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium mb-1">Empfänger*innen</legend>
          <label className="flex gap-2"><input type="radio" name="scope" value="confirmed" checked={scope === 'confirmed'} onChange={() => setScope('confirmed')} />nur bestätigte Buchungen</label>
          <label className="flex gap-2"><input type="radio" name="scope" value="active" checked={scope === 'active'} onChange={() => setScope('active')} />auch unbestätigte Reservierungen</label>
          <label className="flex gap-2 pt-2"><input type="radio" name="tables" value="all" checked={!onlyTables} onChange={() => setOnlyTables(false)} />alle Tische</label>
          <label className="flex gap-2"><input type="radio" name="tables" value="selected" checked={onlyTables} onChange={() => setOnlyTables(true)} />nur diese Tische:</label>
          {onlyTables && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
              {tables.map(table => (
                <label key={table.key} className="flex gap-1">
                  <input
                    type="checkbox" name="tableKey" value={table.key} checked={selected.has(table.key)}
                    onChange={e => {
                      const next = new Set(selected)
                      if (e.currentTarget.checked) next.add(table.key)
                      else next.delete(table.key)
                      setSelected(next)
                    }}
                  />
                  {table.label}
                </label>
              ))}
            </div>
          )}
          <p className="pt-1" data-testid="recipient-count">
            {count} Empfänger*in{count === 1 ? '' : 'nen'} (Buchungen ohne E-Mail-Adresse bekommen nichts)
          </p>
        </fieldset>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="includeIcs" className="mt-1" />
          <span>Aktuellen Kalendereintrag anhängen (nur bei bestätigten Buchungen, z.B. nach einer Zeitänderung)</span>
        </label>

        <div>
          <p className={labelClass}>Vorschau (Klartext)</p>
          <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 whitespace-pre-wrap font-sans" data-testid="broadcast-preview">{`Betreff: ${subject || '(Betreff)'}\n\n${preview}`}</pre>
        </div>

        <button type="submit" formAction={test} className="text-sm bg-gray-100 border border-gray-300 rounded px-3 py-2 hover:bg-gray-200">
          Testmail an mich schicken
        </button>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirmSend" className="mt-1" />
          <span>Ja, an {count} Empfänger*in{count === 1 ? '' : 'nen'} verschicken</span>
        </label>
        <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50" disabled={count === 0}>
          Rundmail verschicken
        </button>
      </fieldset>
    </form>
  )
}
