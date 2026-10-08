// app/rsvp/[eventId]/rsvp-booking.tsx
'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import type { Layout } from '../../lib/floorplan/schema'
import type { PublicUnitState } from '../../lib/events/occupancy'
import type { SeatGroup } from '../../lib/events/seat-rules'
import SeatPicker, { type PickerSeat } from '../../ui/plan/seat-picker'
import PlanViewer from '../../ui/plan/plan-viewer'
import type { UnitVisual } from '../../ui/plan/plan-svg'
import Notice from '../../ui/notice'
import SubmitButton from '../../ui/submit-button'
import { bookViaRsvpAction } from '../actions'

type RsvpTable = { key: string; label: string; capacity: number; state: PublicUnitState; fits: boolean }

/**
 * Platz- bzw. Tischwahl über eine Zusage (docs/KONZEPT.md Abschnitt 9 A). Name, Adresse und Personenzahl
 * kommen aus rsvp-app und stehen im signierten Link (verstecktes Feld "token"), der Server prüft ihn beim
 * Buchen erneut. SEAT: genau so viele Plätze wie Personen; TABLE: ein passender freier Tisch.
 */
export default function RsvpBooking({ eventId, token, open, partySize, layout, backgroundUrl, title, seats, tables }: {
  eventId: string
  token: string
  open: boolean
  partySize: number
  layout: Layout
  backgroundUrl: string | null
  title: string
  seats?: { seats: PickerSeat[]; groups: SeatGroup[] }
  tables?: { tables: RsvpTable[]; tableSeats: { key: string; tableKey: string }[] }
}) {
  const [state, action, pending] = useActionState(bookViaRsvpAction, null)
  const [selectedSeats, setSelectedSeats] = useState<string[]>([])
  const [table, setTable] = useState<string | null>(null)
  const errors = state?.errors ?? []

  const hidden = (
    <>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="token" value={token} />
    </>
  )
  const notice = errors.length > 0 && (
    <Notice tone="error"><ul className="list-disc list-inside">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>
  )
  const privacy = (
    <p className="text-xs text-gray-600 dark:text-gray-400">
      Wir übernehmen Name, Personenzahl und ggf. E-Mail-Adresse aus rsvp-app – siehe <Link href="/datenschutz" target="_blank" className="underline">Datenschutzhinweis</Link>.
    </p>
  )

  if (seats) {
    if (!open) {
      const visuals = new Map<string, UnitVisual>(seats.seats.map(s => [s.key, { state: s.state === 'taken' ? 'confirmed' : s.state }]))
      return <PlanViewer layout={layout} backgroundUrl={backgroundUrl} units={visuals} title={title} />
    }
    const complete = selectedSeats.length === partySize
    return (
      <form action={action} className="space-y-4">
        {hidden}
        {notice}
        <SeatPicker layout={layout} backgroundUrl={backgroundUrl} title={title} seats={seats.seats} groups={seats.groups} max={partySize} initial={[]} onChange={setSelectedSeats} />
        <SubmitButton disabled={pending || !complete}>{complete ? `${partySize === 1 ? 'Platz' : `${partySize} Plätze`} buchen` : `Noch ${partySize - selectedSeats.length} ${partySize - selectedSeats.length === 1 ? 'Platz' : 'Plätze'} wählen`}</SubmitButton>
        {privacy}
      </form>
    )
  }

  const list = tables?.tables ?? []
  const byTable = new Map(list.map(t => [t.key, t]))
  const visuals = new Map<string, UnitVisual>()
  for (const t of list) {
    const choosable = open && t.state === 'free' && t.fits
    visuals.set(t.key, { state: t.state === 'occupied' ? 'confirmed' : t.state, highlighted: t.key === table || (choosable && table === null), dimmed: open && !choosable && t.key !== table })
  }
  for (const seat of tables?.tableSeats ?? []) {
    const t = byTable.get(seat.tableKey)
    if (t) visuals.set(seat.key, { state: t.state === 'occupied' ? 'confirmed' : t.state })
  }
  const choosable = list.filter(t => t.state === 'free' && t.fits).sort((a, b) => a.label.localeCompare(b.label, 'de', { numeric: true }))

  return (
    <form action={action} className="space-y-4">
      {hidden}
      {notice}
      <PlanViewer
        layout={layout} backgroundUrl={backgroundUrl} units={visuals} title={title}
        onUnitClick={open ? key => { if (byTable.get(key)?.state === 'free' && byTable.get(key)?.fits) setTable(key) } : undefined}
      />
      {open && (
        choosable.length === 0 ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">Gerade ist kein passender Tisch für {partySize} {partySize === 1 ? 'Person' : 'Personen'} frei. Bitte wende dich an die Veranstalter*innen.</p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Passende freie Tische für {partySize} {partySize === 1 ? 'Person' : 'Personen'}</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {choosable.map(t => (
                <label key={t.key} className="flex items-center gap-1.5">
                  <input type="radio" name="unitKey" value={t.key} checked={table === t.key} onChange={() => setTable(t.key)} />
                  {t.label} ({t.capacity} Plätze)
                </label>
              ))}
            </div>
            <SubmitButton disabled={pending || table === null}>{table ? `${byTable.get(table)?.label} buchen` : 'Tisch wählen'}</SubmitButton>
            {privacy}
          </fieldset>
        )
      )}
    </form>
  )
}
