// app/ui/plan/seat-picker.tsx
'use client'

import { useId, useState } from 'react'
import type { Layout } from '../../lib/floorplan/schema'
import { suggestSeats, type SeatGroup, type SeatState } from '../../lib/events/seat-rules'
import PlanViewer from './plan-viewer'
import type { UnitVisual } from './plan-svg'

/**
 * Platzwahl im Modus SEAT (docs/KONZEPT.md Abschnitt 1): Plätze im Plan antippen oder - gleichwertig,
 * auch per Tastatur und Screenreader - in der Liste ankreuzen (nach Reihe bzw. Tisch gruppiert), dazu
 * "N nebeneinander vorschlagen". Die Auswahl steht als versteckte Felder "unitKey" im umgebenden
 * Formular; der Server prüft sie erneut (app/lib/events/places.ts).
 *
 * Bekommt nur Schlüssel, Beschriftung und Zustand der Plätze - nie Angaben zu Buchungen.
 */

export type PickerSeat = { key: string; label: string; state: SeatState }

const STATE_TEXT: Record<SeatState, string> = { free: 'frei', taken: 'belegt', unavailable: 'nicht buchbar' }

/** "Reihe A, Platz 3" -> "Platz 3" innerhalb der Gruppe "Reihe A". */
function shortLabel(label: string): string {
  return /, (Platz \d+)$/.exec(label)?.[1] ?? label
}

export default function SeatPicker({ layout, backgroundUrl, title, seats, groups, initial = [], max, onChange, onNoSuggestion }: {
  layout: Layout
  backgroundUrl: string | null
  title: string
  seats: PickerSeat[]
  groups: SeatGroup[]
  initial?: string[]
  /** Höchstzahl (null = keine, Veranstalter*innen). */
  max: number | null
  onChange?: (selected: string[]) => void
  /** Kein Vorschlag für n Plätze nebeneinander möglich (z.B. um die Warteliste anzubieten). */
  onNoSuggestion?: (n: number | null) => void
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  const [wanted, setWanted] = useState(String(Math.max(1, Math.min(initial.length || 2, max ?? 50))))
  const [message, setMessage] = useState<string | null>(null)
  // Auf-/zugeklappte Gruppen der Liste: anfangs die mit gewählten Plätzen, danach wie von Hand gesetzt.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(groups.filter(g => g.segments.flat().some(k => initial.includes(k))).map(g => g.label)))
  const id = useId()
  const byKey = new Map(seats.map(seat => [seat.key, seat]))

  function update(next: string[]) {
    // Gruppen mit neu gewählten Plätzen in der Liste aufklappen, damit sie die Auswahl zeigt.
    const added = next.filter(key => !selected.includes(key))
    if (added.length > 0) {
      const labels = groups.filter(g => g.segments.some(segment => segment.some(key => added.includes(key)))).map(g => g.label)
      setOpenGroups(current => (labels.every(l => current.has(l)) ? current : new Set([...current, ...labels])))
    }
    setSelected(next)
    setMessage(null)
    onChange?.(next)
    onNoSuggestion?.(null)
  }

  function toggle(key: string) {
    const seat = byKey.get(key)
    if (!seat) return
    if (selected.includes(key)) return update(selected.filter(k => k !== key))
    if (seat.state !== 'free') return
    if (max !== null && selected.length >= max) {
      setMessage(`Höchstens ${max} ${max === 1 ? 'Platz' : 'Plätze'} pro Buchung.`)
      return
    }
    update([...selected, key])
  }

  function suggest() {
    const n = Number(wanted)
    if (!Number.isInteger(n) || n < 1) return
    if (max !== null && n > max) {
      setMessage(`Höchstens ${max} ${max === 1 ? 'Platz' : 'Plätze'} pro Buchung.`)
      return
    }
    // Die eigene Auswahl zählt als frei - ein neuer Vorschlag ersetzt sie.
    const free = new Set(seats.filter(s => s.state === 'free' || selected.includes(s.key)).map(s => s.key))
    const found = suggestSeats(groups, free, n)
    if (!found) {
      setMessage(`Gerade sind keine ${n} Plätze nebeneinander frei.`)
      onNoSuggestion?.(n)
      return
    }
    update(found)
  }

  const visuals = new Map<string, UnitVisual>()
  for (const seat of seats) {
    const chosen = selected.includes(seat.key)
    visuals.set(seat.key, { state: chosen ? 'free' : seat.state === 'taken' ? 'confirmed' : seat.state, highlighted: chosen })
  }
  const freeCount = seats.filter(s => s.state === 'free').length

  return (
    <div className="space-y-3">
      {selected.map(key => <input key={key} type="hidden" name="unitKey" value={key} />)}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`${id}-n`} className="block text-sm font-medium mb-1">Wie viele Plätze nebeneinander?</label>
          <input id={`${id}-n`} type="number" inputMode="numeric" min={1} max={max ?? undefined} value={wanted} onChange={e => setWanted(e.currentTarget.value)} className="w-24 border border-gray-300 p-2 rounded" />
        </div>
        <button type="button" onClick={suggest} className="bg-gray-100 border border-gray-300 rounded px-3 py-2 text-sm hover:bg-gray-200">Plätze vorschlagen</button>
        {selected.length > 0 && <button type="button" onClick={() => update([])} className="text-sm text-blue-700 hover:underline pb-2">Auswahl leeren</button>}
      </div>
      <p className="text-sm text-gray-700" role="status" aria-live="polite" data-testid="seat-selection">
        {selected.length === 0
          ? `Keine Plätze gewählt – ${freeCount} von ${seats.length} frei. Tippe im Plan auf freie Plätze oder wähle sie in der Liste.`
          : `${selected.length} ${selected.length === 1 ? 'Platz' : 'Plätze'} gewählt${max !== null ? ` (höchstens ${max})` : ''}: ${selected.map(k => byKey.get(k)?.label ?? k).join('; ')}`}
      </p>
      {message && <p className="text-sm text-amber-800" role="alert">{message}</p>}

      <PlanViewer layout={layout} backgroundUrl={backgroundUrl} units={visuals} title={title} onUnitClick={toggle} />
      <p className="text-xs text-gray-600">Bitte lass möglichst keine einzelnen Plätze zwischen zwei Buchungen frei.</p>

      <div className="space-y-1">
        <p className="text-sm font-medium">Alle Plätze</p>
        {groups.map(group => {
          const keys = group.segments.flat().filter(key => byKey.has(key))
          if (keys.length === 0) return null
          const free = keys.filter(key => byKey.get(key)!.state === 'free').length
          return (
            <details
              key={group.label} open={openGroups.has(group.label)} className="border border-gray-200 rounded"
              onToggle={e => {
                const isOpen = e.currentTarget.open
                setOpenGroups(current => {
                  if (current.has(group.label) === isOpen) return current
                  const next = new Set(current)
                  if (isOpen) next.add(group.label)
                  else next.delete(group.label)
                  return next
                })
              }}
            >
              <summary className="cursor-pointer px-2 py-1 text-sm">{group.label} <span className="text-gray-600">· {free} von {keys.length} frei</span></summary>
              <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-2 text-sm">
                {keys.map(key => {
                  const seat = byKey.get(key)!
                  const chosen = selected.includes(key)
                  return (
                    <label key={key} className={`flex items-center gap-1 ${seat.state !== 'free' && !chosen ? 'text-gray-500' : ''}`}>
                      <input type="checkbox" checked={chosen} disabled={seat.state !== 'free' && !chosen} onChange={() => toggle(key)} aria-label={seat.label} />
                      {shortLabel(seat.label)}{seat.state !== 'free' && !chosen && ` (${STATE_TEXT[seat.state]})`}
                    </label>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
