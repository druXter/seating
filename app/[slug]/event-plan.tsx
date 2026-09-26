// app/[slug]/event-plan.tsx
'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import type { Layout } from '../lib/floorplan/schema'
import { tableFits, type PublicUnitState } from '../lib/events/occupancy'
import PlanViewer from '../ui/plan/plan-viewer'
import type { UnitVisual } from '../ui/plan/plan-svg'
import { waitlistChoice } from '../lib/events/waitlist-rules'
import { joinWaitlistAction, reserveAction } from './booking-actions'
import { PendingPanel, ReserveForm, WaitlistForm } from './booking-panel'

/**
 * Öffentliche Planansicht einer Tischbuchung (Modus TABLE): Plan mit Belegung, Gruppengröße als
 * Filter (passende freie Tische hervorgehoben, andere abgeblendet) und eine gleichwertige
 * Listenansicht für Screenreader und kleine Bildschirme (Konzept Abschnitt 2, "Kundenansicht").
 *
 * Bekommt vom Server nur Schlüssel, Beschriftung, Größe und öffentlichen Zustand der Tische - nie
 * Namen oder sonstige Angaben zu Buchungen.
 *
 * Buchen (wenn geöffnet): Tisch im Plan antippen oder in der Liste "Buchen" wählen -> Formular ->
 * nach dem Reservieren Code-Eingabe. Solange eine Reservierung offen ist, bleibt die Auswahl gesperrt.
 */

export type BookingOptions = { eventId: string; open: boolean; requirePhone: boolean; waitlist: boolean }

export type PublicTable = { key: string; label: string; capacity: number; bookable: boolean; state: PublicUnitState }

const STATE_TEXT: Record<PublicUnitState, string> = { free: 'frei', occupied: 'belegt', unavailable: 'nicht buchbar' }

function Swatch({ kind }: { kind: 'free' | 'occupied' | 'unavailable' | 'match' | 'dimmed' }) {
  return (
    <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <defs>
        <pattern id="legend-occupied" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={6} height={6} fill="#fecaca" />
          <line x1={0} y1={0} x2={0} y2={6} stroke="#b91c1c" strokeWidth={2.5} />
        </pattern>
      </defs>
      <circle
        cx={11} cy={11} r={9}
        fill={kind === 'occupied' ? 'url(#legend-occupied)' : kind === 'unavailable' ? '#cbd5e1' : '#dcfce7'}
        stroke={kind === 'match' ? '#2563eb' : '#334155'} strokeWidth={kind === 'match' ? 3 : 1.5}
        opacity={kind === 'dimmed' ? 0.3 : 1}
      />
    </svg>
  )
}

export default function EventPlan({ layout, backgroundUrl, tables, tableSeats, minFillRatio, title, booking }: {
  layout: Layout
  backgroundUrl: string | null
  tables: PublicTable[]
  /** Plätze an Tischen: werden wie ihr Tisch eingefärbt. */
  tableSeats: { key: string; tableKey: string }[]
  minFillRatio: number | null
  title: string
  booking: BookingOptions
}) {
  const [partyInput, setPartyInput] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [reserveState, reserve, reserving] = useActionState(reserveAction, null)
  const [waitlistState, joinWaitlist, joining] = useActionState(joinWaitlistAction, null)
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputId = useId()
  const pendingReservation = reserveState?.step === 'pending' ? reserveState : null
  const pendingWaitlist = waitlistState?.step === 'pending' ? waitlistState : null
  const busy = pendingReservation !== null || pendingWaitlist !== null
  const selected = tables.find(t => t.key === selectedKey) ?? null

  function select(key: string) {
    if (!booking.open || busy) return
    const table = tables.find(t => t.key === key)
    if (table?.state === 'free') {
      setSelectedKey(key)
      setWaitlistOpen(false)
    }
  }

  // Formular nach der Auswahl in den Blick holen (auf dem Handy liegt es unter dem Plan).
  useEffect(() => {
    if (selectedKey || waitlistOpen) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedKey, waitlistOpen])
  const maxCapacity = Math.max(1, ...tables.map(t => t.capacity))
  const partySize = /^\d+$/.test(partyInput) ? Number(partyInput) : null
  const filtering = partySize !== null && partySize >= 1

  const fits = (table: PublicTable) => partySize !== null && tableFits(table.capacity, partySize, minFillRatio)
  const matching = filtering ? tables.filter(t => t.state === 'free' && fits(t)) : []
  // Warteliste: nur wenn kein passender Tisch frei ist, es aber passende gibt (Konzept Abschnitt 5).
  const choice = filtering && partySize !== null
    ? waitlistChoice(tables.map(t => ({ capacity: t.capacity, bookable: t.bookable, free: t.state === 'free' })), partySize, minFillRatio, booking.waitlist)
    : null

  const visuals = new Map<string, UnitVisual>()
  const byKey = new Map<string, UnitVisual>()
  for (const table of tables) {
    const match = filtering && table.state === 'free' && fits(table)
    const visual: UnitVisual = {
      state: table.state === 'occupied' ? 'confirmed' : table.state,
      highlighted: match || table.key === selectedKey,
      dimmed: filtering && !match && table.key !== selectedKey
    }
    visuals.set(table.key, visual)
    byKey.set(table.key, visual)
  }
  for (const seat of tableSeats) {
    const table = byKey.get(seat.tableKey)
    if (table) visuals.set(seat.key, { state: table.state })
  }

  const sorted = [...tables].sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))
  const freeCount = tables.filter(t => t.state === 'free').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium mb-1">Wie viele Personen seid ihr?</label>
          <input
            id={inputId} type="number" inputMode="numeric" min={1} max={maxCapacity} value={partyInput}
            onChange={event => setPartyInput(event.currentTarget.value)}
            className="w-32 border border-gray-300 p-2 rounded"
          />
        </div>
        {filtering && (
          <button type="button" className="text-sm text-blue-700 hover:underline pb-2" onClick={() => setPartyInput('')}>Filter aufheben</button>
        )}
      </div>
      <p className="text-sm text-gray-700" role="status" aria-live="polite">
        {filtering
          ? matching.length > 0
            ? `${matching.length} passende${matching.length === 1 ? 'r' : ''} Tisch${matching.length === 1 ? '' : 'e'} frei für ${partySize} ${partySize === 1 ? 'Person' : 'Personen'}.`
            : `Für ${partySize} ${partySize === 1 ? 'Person' : 'Personen'} ist gerade kein passender Tisch frei.`
          : `${freeCount} von ${tables.length} Tischen frei.`}
      </p>

      {booking.open && !busy && !selected && !waitlistOpen && choice === 'waitlist' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Trag dich auf die Warteliste ein – wird ein passender Tisch frei, bekommst du ein Angebot per Mail.</span>
          <button type="button" onClick={() => { setWaitlistOpen(true); setSelectedKey(null) }} className="bg-blue-600 text-white font-bold py-1.5 px-3 rounded hover:bg-blue-700">
            Auf die Warteliste
          </button>
        </div>
      )}
      {choice === 'too-large' && <p className="text-sm text-gray-700">Für so viele Personen gibt es keinen passenden Tisch.</p>}

      <PlanViewer
        layout={layout} backgroundUrl={backgroundUrl} units={visuals} title={title}
        onUnitClick={booking.open && !busy ? select : undefined}
      />

      {booking.open && (busy || selected || waitlistOpen) && (
        <div ref={panelRef} className="border-2 border-blue-200 rounded-lg p-4 scroll-mt-4">
          {pendingReservation ? (
            <PendingPanel bookingId={pendingReservation.bookingId} resendHint="Die Reservierung verlängert sich dadurch nicht.">
              <strong>{pendingReservation.placeLabel}</strong> ist bis {pendingReservation.expiresAtText} für dich reserviert. Wir haben eine Mail an{' '}
              <strong>{pendingReservation.email}</strong> geschickt – bitte bestätige deine Adresse mit dem Link oder dem Code aus der Mail.
              Ohne Bestätigung wird der Tisch danach wieder frei.
            </PendingPanel>
          ) : pendingWaitlist ? (
            <PendingPanel bookingId={pendingWaitlist.bookingId} resendHint="Die Frist verlängert sich dadurch nicht.">
              Wir haben eine Mail an <strong>{pendingWaitlist.email}</strong> geschickt. Bitte bestätige deine Adresse bis {pendingWaitlist.expiresAtText} mit
              dem Link oder dem Code aus der Mail – erst dann stehst du auf der Warteliste.
            </PendingPanel>
          ) : waitlistOpen && partySize !== null ? (
            <WaitlistForm
              eventId={booking.eventId}
              partySize={partySize}
              requirePhone={booking.requirePhone}
              action={joinWaitlist}
              pending={joining}
              errors={waitlistState?.step === 'form' ? waitlistState.errors : []}
              onClose={() => setWaitlistOpen(false)}
            />
          ) : selected && (
            <ReserveForm
              key={selected.key}
              eventId={booking.eventId}
              table={selected}
              partySize={partySize}
              requirePhone={booking.requirePhone}
              action={reserve}
              pending={reserving}
              errors={reserveState?.step === 'form' ? reserveState.errors : []}
              onClose={() => setSelectedKey(null)}
            />
          )}
        </div>
      )}
      {booking.open && !selected && !busy && !waitlistOpen && (
        <p className="text-sm text-gray-700">Tippe im Plan auf einen freien Tisch oder wähle ihn unten in der Liste, um ihn zu buchen.</p>
      )}

      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700" aria-label="Legende">
        <li className="flex items-center gap-1.5"><Swatch kind="free" />frei</li>
        <li className="flex items-center gap-1.5"><Swatch kind="occupied" />belegt (schraffiert)</li>
        <li className="flex items-center gap-1.5"><Swatch kind="unavailable" />nicht buchbar</li>
        {filtering && <li className="flex items-center gap-1.5"><Swatch kind="match" />passt zu eurer Gruppe</li>}
        {filtering && <li className="flex items-center gap-1.5"><Swatch kind="dimmed" />passt nicht (abgeblendet)</li>}
      </ul>

      <section aria-labelledby="table-list-heading" className="space-y-2">
        <h2 id="table-list-heading" className="font-bold">Alle Tische</h2>
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-600">Dieser Plan enthält keine Tische.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th scope="col" className="py-1 pr-2">Tisch</th>
                <th scope="col" className="py-1 pr-2">Plätze</th>
                <th scope="col" className="py-1 pr-2">Status</th>
                {filtering && <th scope="col" className="py-1 pr-2">Für {partySize}</th>}
                {booking.open && !busy && <th scope="col" className="py-1"><span className="sr-only">Aktion</span></th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map(table => (
                <tr key={table.key} className={`border-b last:border-0 ${filtering && !(table.state === 'free' && fits(table)) ? 'text-gray-500' : ''}`}>
                  <th scope="row" className="py-1 pr-2 font-normal text-left">{table.label}</th>
                  <td className="py-1 pr-2">{table.capacity}</td>
                  <td className="py-1 pr-2">{STATE_TEXT[table.state]}</td>
                  {filtering && <td className="py-1 pr-2">{table.state !== 'free' ? '–' : fits(table) ? 'passt' : 'passt nicht'}</td>}
                  {booking.open && !busy && (
                    <td className="py-1 text-right">
                      {table.state === 'free' && (!filtering || fits(table)) && (
                        <button
                          type="button" onClick={() => select(table.key)} aria-label={`${table.label} buchen`}
                          className="text-blue-700 hover:underline"
                        >
                          Buchen
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
