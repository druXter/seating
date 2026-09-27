// app/ui/plan/arrange-board.tsx
'use client'

import { useEffect, useEffectEvent, useId, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import Link from 'next/link'
import type { Layout } from '../../lib/floorplan/schema'
import type { BoardParty, BoardSeat } from '../../lib/events/assign'
import type { MoveBoardBooking } from '../../lib/events/admin-booking'
import type { UnitState } from '../../lib/events/occupancy'
import { initials } from '../../lib/events/assign-rules'
import { moveBookingOnPlan, placeAttendeeOnPlan, placePartyOnPlan, type ArrangeResult } from '../../admin/events/arrange-actions'
import PlanViewer from './plan-viewer'
import { STATE_TEXT, type UnitVisual } from './plan-svg'

/**
 * Sitzordnung und Verschieben im Plan (docs/KONZEPT.md Abschnitt 8, Phase 6). Drei gleichwertige Wege:
 *
 * - Ziehen mit Maus oder Stift (Pointer Events, kein HTML5-Drag&Drop - das geht auf Touch-Geräten nicht):
 *   Person, Gruppe oder Buchung auf einen Platz bzw. Tisch ziehen.
 * - Antippen, dann Ziel antippen (Finger scrollen weiter die Seite, statt versehentlich zu ziehen).
 * - Tastatur/Screenreader: Person bzw. Buchung in der Liste wählen (Knöpfe), Ziel aus einer Auswahlliste.
 *
 * Der Server prüft jede Aktion erneut (app/admin/events/arrange-actions.ts) und lädt danach die Ansicht
 * neu (refresh). AssignBoard: Modus ASSIGNED, wirkt sofort (interne Planung, keine Mails). MoveBoard:
 * TABLE/SEAT, erst nach Rückfrage - dort hängen echte Buchungen samt Änderungsmail daran.
 */

type Point = { x: number; y: number }

/** Ablageziel unter dem Zeiger: eine Einheit im Plan oder die Liste ("vom Platz nehmen"). */
type DropTarget = { kind: 'unit'; key: string } | { kind: 'list' } | null

function targetAt(point: Point): DropTarget {
  const element = document.elementFromPoint(point.x, point.y)?.closest('[data-unit-key], [data-drop="list"]')
  if (!element) return null
  const key = element.getAttribute('data-unit-key')
  return key ? { kind: 'unit', key } : { kind: 'list' }
}

/**
 * Ziehen per Pointer Events: start() beim Drücken (nur Maus/Stift), ab 5 Pixeln Bewegung ist es ein
 * Ziehen (davor ein normaler Klick). Beim Loslassen onDrop mit dem Ziel unter dem Zeiger. Der Klick,
 * den der Browser nach dem Loslassen noch schickt, wird verschluckt (suppressClick).
 */
function useDrag<S>(onDrop: (source: S, target: DropTarget) => void) {
  const [drag, setDrag] = useState<{ source: S; label: string; point: Point; target: DropTarget } | null>(null)
  const pending = useRef<{ source: S; label: string; start: Point; pointerId: number } | null>(null)
  const clickSuppressed = useRef(false)

  const move = useEffectEvent((event: PointerEvent) => {
    const current = pending.current
    if (!current || event.pointerId !== current.pointerId) return
    const point = { x: event.clientX, y: event.clientY }
    if (!drag && Math.hypot(point.x - current.start.x, point.y - current.start.y) < 5) return
    event.preventDefault()
    setDrag({ source: current.source, label: current.label, point, target: targetAt(point) })
  })
  const up = useEffectEvent((event: PointerEvent) => {
    const current = pending.current
    if (!current || event.pointerId !== current.pointerId) return
    pending.current = null
    if (drag) {
      clickSuppressed.current = true
      setTimeout(() => { clickSuppressed.current = false }, 0)
      setDrag(null)
      if (event.type === 'pointerup') onDrop(current.source, targetAt({ x: event.clientX, y: event.clientY }))
    }
  })

  useEffect(() => {
    const onMove = (event: PointerEvent) => move(event)
    const onUp = (event: PointerEvent) => up(event)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  function start(source: S, label: string, event: { pointerType: string; button: number; clientX: number; clientY: number; pointerId: number }): boolean {
    if (event.pointerType === 'touch' || event.button !== 0) return false
    pending.current = { source, label, start: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId }
    return true
  }

  function cancel() {
    pending.current = null
    setDrag(null)
  }

  return { drag, start, cancel, clickSuppressed: () => clickSuppressed.current }
}

/** Schild, das dem Zeiger beim Ziehen folgt. */
function DragGhost({ drag }: { drag: { label: string; point: Point } | null }) {
  if (!drag) return null
  return (
    <div
      aria-hidden="true"
      className="fixed z-50 pointer-events-none bg-blue-600 text-white text-sm rounded px-2 py-1 shadow"
      style={{ left: drag.point.x + 14, top: drag.point.y + 14 }}
    >
      {drag.label}
    </div>
  )
}

const chip = 'select-none rounded border px-2 py-1 text-sm text-left'
const button = 'text-sm rounded px-3 py-1 border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50'
const primary = 'text-sm rounded px-3 py-1 bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50'

function Message({ result }: { result: ArrangeResult | null }) {
  return (
    <p role="status" aria-live="polite" data-testid="arrange-message" className={`text-sm min-h-5 ${result?.ok === false ? 'text-red-700' : 'text-green-800'}`}>
      {result ? (result.ok ? result.message : result.error) : ''}
    </p>
  )
}

/** Escape bricht Auswahl und Ziehen ab. */
function useEscape(handler: () => void) {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') handler()
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

// --- Sitzordnung (Modus ASSIGNED) ---------------------------------------------------------------

type AssignSource = { kind: 'person'; id: string } | { kind: 'party'; id: string }

const TABLE_OF_SEAT = /^(t[1-9][0-9]*)-s[1-9][0-9]*$/

export function AssignBoard({ eventId, layout, backgroundUrl, title, parties, seats, tables }: {
  eventId: string
  layout: Layout
  backgroundUrl: string | null
  title: string
  parties: BoardParty[]
  seats: BoardSeat[]
  tables: { key: string; label: string; capacity: number }[]
}) {
  const [selected, setSelected] = useState<AssignSource | null>(null)
  const [result, setResult] = useState<ArrangeResult | null>(null)
  const [query, setQuery] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [targetKey, setTargetKey] = useState('')
  const [busy, startTransition] = useTransition()
  const id = useId()

  const persons = new Map(parties.flatMap(party => party.persons.map(person => [person.id, { ...person, party }] as const)))
  const seatByKey = new Map(seats.map(seat => [seat.key, seat]))
  const partyById = new Map(parties.map(party => [party.id, party]))
  const occupant = (key: string) => {
    const attendeeId = seatByKey.get(key)?.attendeeId
    return attendeeId ? persons.get(attendeeId) ?? null : null
  }
  const seatLabel = (key: string | null) => (key ? seatByKey.get(key)?.label ?? key : 'ohne Platz')
  const sourceLabel = (source: AssignSource) => (source.kind === 'person' ? persons.get(source.id)?.name ?? '' : `Gruppe ${partyById.get(source.id)?.name ?? ''}`)

  /** Ein Tisch als Ziel: dessen erster freier Platz (bzw. der Start für die Gruppe). */
  function resolveTarget(key: string): string | null {
    if (seatByKey.has(key)) return key
    const free = seats.find(seat => TABLE_OF_SEAT.exec(seat.key)?.[1] === key && !seat.attendeeId)
    return free?.key ?? null
  }

  function act(source: AssignSource, rawTarget: string | null) {
    const target = rawTarget === null ? null : resolveTarget(rawTarget)
    if (rawTarget !== null && target === null) {
      setResult({ ok: false, error: `An ${tables.find(t => t.key === rawTarget)?.label ?? 'diesem Tisch'} ist kein Platz mehr frei.` })
      return
    }
    setSelected(null)
    setTargetKey('')
    startTransition(async () => {
      if (source.kind === 'person') {
        const person = persons.get(source.id)
        if (!person) return
        setResult(await placeAttendeeOnPlan(eventId, person.id, person.seatKey, target))
      } else if (target) {
        setResult(await placePartyOnPlan(eventId, source.id, target))
      }
    })
  }

  const drag = useDrag<AssignSource>((source, target) => {
    if (!target) return
    if (target.kind === 'list') {
      if (source.kind === 'person') act(source, null)
      return
    }
    act(source, target.key)
  })
  useEscape(() => {
    drag.cancel()
    setSelected(null)
  })

  /** Antippen/Klick auf eine Einheit: mit Auswahl ist sie das Ziel, sonst wird die Person darauf gewählt. */
  function onUnitClick(key: string) {
    if (drag.clickSuppressed() || busy) return
    if (selected) return act(selected, key)
    const person = occupant(key)
    if (person) setSelected({ kind: 'person', id: person.id })
  }

  function onUnitDragStart(key: string, event: ReactPointerEvent<SVGSVGElement>): boolean {
    const person = occupant(key)
    if (!person || busy) return false
    return drag.start({ kind: 'person', id: person.id }, person.name, event)
  }

  function toggle(source: AssignSource) {
    if (drag.clickSuppressed()) return
    setSelected(current => (current && current.kind === source.kind && current.id === source.id ? null : source))
    setTargetKey('')
  }

  // Hervorhebung: gewählte Person bzw. alle Plätze der gewählten Gruppe, dazu das Ziel beim Ziehen.
  const highlightedSeats = new Set<string>()
  const selectedParty = selected?.kind === 'party' ? partyById.get(selected.id) : selected ? persons.get(selected.id)?.party : undefined
  for (const person of selectedParty?.persons ?? []) if (person.seatKey) highlightedSeats.add(person.seatKey)
  const dropKey = drag.drag?.target?.kind === 'unit' ? drag.drag.target.key : null
  if (dropKey) highlightedSeats.add(dropKey)

  const seatedPerTable = new Map<string, number>()
  for (const seat of seats) {
    const table = TABLE_OF_SEAT.exec(seat.key)?.[1]
    if (table && seat.attendeeId) seatedPerTable.set(table, (seatedPerTable.get(table) ?? 0) + 1)
  }
  const visuals = new Map<string, UnitVisual>()
  for (const seat of seats) {
    const person = occupant(seat.key)
    visuals.set(seat.key, {
      state: person ? 'confirmed' : 'free',
      highlighted: highlightedSeats.has(seat.key),
      caption: person ? initials(person.name) : undefined,
      title: person ? `${seat.label}: ${person.name} (${person.party.name})` : `${seat.label}: frei`
    })
  }
  for (const table of tables) {
    const seated = seatedPerTable.get(table.key) ?? 0
    visuals.set(table.key, {
      state: seated >= table.capacity ? 'confirmed' : 'free', highlighted: dropKey === table.key,
      caption: `${seated} von ${table.capacity}`, title: `${table.label}: ${seated} von ${table.capacity} Plätzen besetzt`
    })
  }

  const needle = query.trim().toLocaleLowerCase('de')
  const shown = parties.filter(party =>
    (!onlyOpen || party.persons.some(p => !p.seatKey))
    && (!needle || party.name.toLocaleLowerCase('de').includes(needle) || party.persons.some(p => p.name.toLocaleLowerCase('de').includes(needle)))
  )
  const total = persons.size
  const seated = [...persons.values()].filter(p => p.seatKey).length
  const groupsOfSeats = [...new Set(seats.map(s => s.group))]
  const selectedPerson = selected?.kind === 'person' ? persons.get(selected.id) : undefined
  const unplacedOfSelectedParty = selected?.kind === 'party' ? selectedParty?.persons.filter(p => !p.seatKey).length ?? 0 : 0

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
      <DragGhost drag={drag.drag} />
      <section
        aria-label="Gästeliste" data-drop="list"
        className={`bg-white rounded-lg shadow p-4 space-y-3 ${drag.drag?.target?.kind === 'list' ? 'ring-2 ring-blue-500' : ''}`}
      >
        <h2 className="font-bold">Gäste</h2>
        <p className="text-sm text-gray-700" data-testid="seated-count">{seated} von {total} {total === 1 ? 'Person hat' : 'Personen haben'} einen Platz.</p>
        <div className="space-y-2">
          <label htmlFor={`${id}-q`} className="sr-only">Gäste suchen</label>
          <input id={`${id}-q`} value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Suchen" className="w-full border border-gray-300 p-2 rounded text-sm" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.currentTarget.checked)} /> Nur Gruppen mit Personen ohne Platz
          </label>
        </div>
        {parties.length === 0 && <p className="text-sm text-gray-600">Noch keine Gäste – leg oben Gruppen an oder importiere eine CSV-Datei.</p>}
        <ul className="space-y-2">
          {shown.map(party => {
            const open = party.persons.filter(p => !p.seatKey).length
            const partySelected = selected?.kind === 'party' && selected.id === party.id
            return (
              <li key={party.id} className="border border-gray-200 rounded p-2 space-y-1" data-testid="party">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">{party.name}</span>
                  <Link href={`/admin/events/${eventId}/bookings/${party.id}`} className="text-xs text-blue-700 hover:underline">bearbeiten</Link>
                </div>
                <p className="text-xs text-gray-600">
                  {party.persons.length - open} von {party.persons.length} mit Platz
                  {party.spread.length > 1 && <span className="text-amber-800" data-testid="party-split"> · getrennt: {party.spread.join(', ')}</span>}
                </p>
                {party.adminNote && <p className="text-xs text-purple-800 whitespace-pre-line">{party.adminNote}</p>}
                {open > 0 && party.persons.length > 1 && (
                  <button
                    type="button" aria-pressed={partySelected} disabled={busy}
                    className={`${chip} ${partySelected ? 'border-blue-600 bg-blue-50' : 'border-dashed border-gray-400 bg-gray-50'} cursor-grab`}
                    onPointerDown={e => { drag.start({ kind: 'party', id: party.id }, `Gruppe ${party.name}`, e) }}
                    onClick={() => toggle({ kind: 'party', id: party.id })}
                  >
                    {open === party.persons.length ? 'Ganze Gruppe' : `Alle ${open} ohne Platz`} zusammen setzen
                  </button>
                )}
                <ul className="flex flex-wrap gap-1">
                  {party.persons.map(person => {
                    const isSelected = selected?.kind === 'person' && selected.id === person.id
                    return (
                      <li key={person.id}>
                        <button
                          type="button" aria-pressed={isSelected} disabled={busy} data-attendee={person.name}
                          className={`${chip} cursor-grab ${isSelected ? 'border-blue-600 bg-blue-50' : person.seatKey ? 'border-gray-300 bg-white' : 'border-amber-400 bg-amber-50'}`}
                          onPointerDown={e => { drag.start({ kind: 'person', id: person.id }, person.name, e) }}
                          onClick={() => toggle({ kind: 'person', id: person.id })}
                        >
                          {person.name}
                          <span className="block text-xs text-gray-600">{seatLabel(person.seatKey)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
        {parties.length > 0 && <p className="text-xs text-gray-600">Eine Person hierher ziehen nimmt sie vom Platz.</p>}
      </section>

      <section aria-label="Plan" className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="space-y-2 border border-gray-200 rounded p-2 bg-gray-50" data-testid="selection">
          {!selected ? (
            <p className="text-sm text-gray-700">
              Ziehe Personen oder Gruppen auf Plätze oder Tische – oder wähle sie in der Liste und tippe dann auf einen Platz.
              Auf einen besetzten Platz gezogen, tauschen die beiden.
            </p>
          ) : (
            <form
              className="space-y-2"
              onSubmit={e => {
                e.preventDefault()
                if (targetKey) act(selected, targetKey)
              }}
            >
              <p className="text-sm">
                Ausgewählt: <strong>{sourceLabel(selected)}</strong>
                {selectedPerson && ` (${seatLabel(selectedPerson.seatKey)})`}
                {selected.kind === 'party' && ` – ${unplacedOfSelectedParty} ohne Platz, sie kommen nebeneinander bzw. an denselben Tisch`}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor={`${id}-target`} className="block text-xs font-medium mb-1">{selected.kind === 'party' ? 'Ab Platz' : 'Platz'}</label>
                  <select id={`${id}-target`} value={targetKey} onChange={e => setTargetKey(e.currentTarget.value)} className="border border-gray-300 p-1 rounded text-sm max-w-72">
                    <option value="">– Platz wählen –</option>
                    {groupsOfSeats.map(group => (
                      <optgroup key={group} label={group}>
                        {seats.filter(seat => seat.group === group && (selected.kind === 'person' || !seat.attendeeId)).map(seat => {
                          const person = occupant(seat.key)
                          return (
                            <option key={seat.key} value={seat.key} disabled={person !== null && person.id === selectedPerson?.id}>
                              {seat.label}{person ? ` – ${person.name}${person.id === selectedPerson?.id ? '' : ' (tauschen)'}` : ' – frei'}
                            </option>
                          )
                        })}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <button type="submit" className={primary} disabled={!targetKey || busy}>Hierher setzen</button>
                {selectedPerson?.seatKey && <button type="button" className={button} disabled={busy} onClick={() => act(selected, null)}>Vom Platz nehmen</button>}
                <button type="button" className={button} onClick={() => setSelected(null)}>Abbrechen</button>
              </div>
            </form>
          )}
          <Message result={result} />
        </div>
        <PlanViewer layout={layout} backgroundUrl={backgroundUrl} units={visuals} title={title} onUnitClick={onUnitClick} onUnitDragStart={onUnitDragStart} />
        <p className="text-xs text-gray-600">Im Plan stehen die Initialen, der volle Name erscheint beim Zeigen auf den Platz. Die Sitzordnung ist nur hier sichtbar – öffentlich nie.</p>
      </section>
    </div>
  )
}

// --- Buchungen verschieben (Modus TABLE und SEAT) -----------------------------------------------

type MoveSource = { bookingId: string; from: string }
type PendingMove = MoveSource & { to: string; text: string }

export function MoveBoard({ eventId, mode, layout, backgroundUrl, title, bookings, units, mailable }: {
  eventId: string
  mode: 'TABLE' | 'SEAT'
  layout: Layout
  backgroundUrl: string | null
  title: string
  bookings: MoveBoardBooking[]
  /** Einheiten der buchbaren Art (TABLE: Tische, SEAT: Plätze) mit Zustand. */
  units: { key: string; label: string; state: UnitState }[]
  /** Buchungen mit bestätigter Adresse (bekommen auf Wunsch eine Änderungsmail). */
  mailable: string[]
}) {
  const [selected, setSelected] = useState<MoveSource | null>(null)
  const [pending, setPending] = useState<PendingMove | null>(null)
  const [notify, setNotify] = useState(true)
  const [result, setResult] = useState<ArrangeResult | null>(null)
  const [targetKey, setTargetKey] = useState('')
  const [busy, startTransition] = useTransition()
  const id = useId()
  const what = mode === 'SEAT' ? 'Platz' : 'Tisch'

  const unitByKey = new Map(units.map(unit => [unit.key, unit]))
  const bookingByKey = new Map(bookings.flatMap(booking => booking.keys.map(key => [key, booking] as const)))
  const bookingById = new Map(bookings.map(booking => [booking.id, booking]))
  const label = (key: string) => unitByKey.get(key)?.label ?? key
  const isFree = (key: string) => {
    const state = unitByKey.get(key)?.state
    return (state === 'free' || state === 'unavailable') && !bookingByKey.has(key)
  }

  function propose(source: MoveSource, to: string) {
    const booking = bookingById.get(source.bookingId)
    if (!booking || to === source.from) return
    if (!unitByKey.has(to)) {
      setResult({ ok: false, error: mode === 'SEAT' ? 'Buchungen lassen sich nur auf Plätze verschieben.' : 'Buchungen lassen sich nur auf Tische verschieben.' })
      return
    }
    if (!isFree(to)) {
      setResult({ ok: false, error: `${label(to)} ist belegt.` })
      return
    }
    setResult(null)
    setSelected(null)
    setTargetKey('')
    setPending({ ...source, to, text: `„${booking.name}“ von ${label(source.from)} nach ${label(to)} verschieben?` })
  }

  const drag = useDrag<MoveSource>((source, target) => {
    if (target?.kind === 'unit') propose(source, target.key)
  })
  useEscape(() => {
    drag.cancel()
    setSelected(null)
    setPending(null)
  })

  function confirmMove() {
    if (!pending) return
    const booking = bookingById.get(pending.bookingId)
    if (!booking) return
    const move = pending
    setPending(null)
    startTransition(async () => {
      setResult(await moveBookingOnPlan(eventId, move.bookingId, move.from, move.to, booking.updatedAt, notify))
    })
  }

  function onUnitClick(key: string) {
    if (drag.clickSuppressed() || busy || pending) return
    if (selected) return propose(selected, key)
    const booking = bookingByKey.get(key)
    if (booking) setSelected({ bookingId: booking.id, from: key })
  }

  function onUnitDragStart(key: string, event: ReactPointerEvent<SVGSVGElement>): boolean {
    const booking = bookingByKey.get(key)
    if (!booking || busy || pending) return false
    return drag.start({ bookingId: booking.id, from: key }, `${booking.name} (${label(key)})`, event)
  }

  const highlighted = new Set<string>()
  if (selected) highlighted.add(selected.from)
  if (pending) {
    highlighted.add(pending.from)
    highlighted.add(pending.to)
  }
  const dropKey = drag.drag?.target?.kind === 'unit' ? drag.drag.target.key : null
  if (dropKey) highlighted.add(dropKey)
  const visuals = new Map<string, UnitVisual>()
  for (const unit of units) {
    const booking = bookingByKey.get(unit.key)
    visuals.set(unit.key, {
      state: unit.state, highlighted: highlighted.has(unit.key),
      caption: booking ? (mode === 'SEAT' ? initials(booking.name) : booking.name.slice(0, 18)) : undefined,
      title: booking ? `${unit.label}: ${booking.name} (${booking.partySize} ${booking.partySize === 1 ? 'Person' : 'Personen'})` : `${unit.label}: ${STATE_TEXT[unit.state]}`
    })
  }
  const selectedBooking = selected ? bookingById.get(selected.bookingId) : undefined
  const freeUnits = units.filter(unit => isFree(unit.key))
  const pendingMailable = pending ? mailable.includes(pending.bookingId) : false

  const list: ReactNode = (
    <ul className="space-y-2">
      {bookings.map(booking => (
        <li key={booking.id} className="border border-gray-200 rounded p-2 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-medium">{booking.name}</span>
            <Link href={`/admin/events/${eventId}/bookings/${booking.id}`} className="text-xs text-blue-700 hover:underline">Buchung</Link>
          </div>
          <p className="text-xs text-gray-600">{booking.partySize} {booking.partySize === 1 ? 'Person' : 'Personen'}{booking.status !== 'CONFIRMED' && ` · ${booking.status === 'PENDING' ? 'unbestätigt' : 'Angebot'}`}</p>
          <ul className="flex flex-wrap gap-1">
            {booking.keys.map(key => {
              const isSelected = selected?.bookingId === booking.id && selected.from === key
              return (
                <li key={key}>
                  <button
                    type="button" aria-pressed={isSelected} disabled={busy || pending !== null}
                    aria-label={`${booking.name}: ${label(key)} verschieben`}
                    className={`${chip} cursor-grab ${isSelected ? 'border-blue-600 bg-blue-50' : 'border-gray-300 bg-white'}`}
                    onPointerDown={e => { drag.start({ bookingId: booking.id, from: key }, `${booking.name} (${label(key)})`, e) }}
                    onClick={() => {
                      if (drag.clickSuppressed()) return
                      setSelected(isSelected ? null : { bookingId: booking.id, from: key })
                      setTargetKey('')
                    }}
                  >
                    {label(key)}
                  </button>
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start">
      <DragGhost drag={drag.drag} />
      <section aria-label="Buchungen" className="bg-white rounded-lg shadow p-4 space-y-3">
        <h2 className="font-bold">Aktive Buchungen</h2>
        {bookings.length === 0 ? <p className="text-sm text-gray-600">Keine aktiven Buchungen.</p> : list}
      </section>

      <section aria-label="Plan" className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="space-y-2 border border-gray-200 rounded p-2 bg-gray-50" data-testid="selection">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.currentTarget.checked)} className="mt-1" />
            <span>Kund*innen per Mail benachrichtigen (bestätigte Buchungen, mit Gegenüberstellung alt → neu und neuem Kalendereintrag)</span>
          </label>
          {pending ? (
            <div className="space-y-2" role="alertdialog" aria-labelledby={`${id}-confirm`}>
              <p id={`${id}-confirm`} className="text-sm font-medium">{pending.text}</p>
              <p className="text-xs text-gray-600">
                {pendingMailable ? (notify ? 'Die Kund*in bekommt eine Änderungsmail.' : 'Ohne Mail an die Kund*in.') : 'Diese Buchung bekommt keine Mail (unbestätigt oder ohne Adresse).'}
              </p>
              <div className="flex gap-2">
                <button type="button" className={primary} onClick={confirmMove} autoFocus>Verschieben</button>
                <button type="button" className={button} onClick={() => setPending(null)}>Abbrechen</button>
              </div>
            </div>
          ) : !selected ? (
            <p className="text-sm text-gray-700">
              Ziehe {mode === 'SEAT' ? 'einen belegten Platz auf einen freien' : 'einen belegten Tisch auf einen freien'} – oder wähle in der Liste und tippe dann auf das Ziel.
              Vor dem Verschieben fragen wir nach.
            </p>
          ) : (
            <form
              className="space-y-2"
              onSubmit={e => {
                e.preventDefault()
                if (targetKey) propose(selected, targetKey)
              }}
            >
              <p className="text-sm">Ausgewählt: <strong>{selectedBooking?.name}</strong> ({label(selected.from)})</p>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor={`${id}-target`} className="block text-xs font-medium mb-1">Neuer {what}</label>
                  <select id={`${id}-target`} value={targetKey} onChange={e => setTargetKey(e.currentTarget.value)} className="border border-gray-300 p-1 rounded text-sm max-w-72">
                    <option value="">– {what} wählen –</option>
                    {freeUnits.map(unit => <option key={unit.key} value={unit.key}>{unit.label}{unit.state === 'unavailable' ? ' – nicht buchbar' : ''}</option>)}
                  </select>
                </div>
                <button type="submit" className={primary} disabled={!targetKey || busy}>Weiter</button>
                <button type="button" className={button} onClick={() => setSelected(null)}>Abbrechen</button>
              </div>
            </form>
          )}
          <Message result={result} />
        </div>
        <PlanViewer layout={layout} backgroundUrl={backgroundUrl} units={visuals} title={title} onUnitClick={onUnitClick} onUnitDragStart={onUnitDragStart} />
        <p className="text-xs text-gray-600">
          {mode === 'SEAT'
            ? 'Verschoben wird der eine Platz; die übrigen Plätze der Buchung bleiben. Freie, nicht buchbare Plätze sind als Ziel erlaubt.'
            : 'Die Kapazität des Zieltisches muss reichen, die Mindestbelegung gilt hier nicht. Freie, nicht buchbare Tische sind als Ziel erlaubt.'}
        </p>
      </section>
    </div>
  )
}
