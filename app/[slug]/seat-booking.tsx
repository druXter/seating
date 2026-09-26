// app/[slug]/seat-booking.tsx
'use client'

import { useActionState, useState } from 'react'
import type { Layout } from '../lib/floorplan/schema'
import type { SeatGroup } from '../lib/events/seat-rules'
import SeatPicker, { type PickerSeat } from '../ui/plan/seat-picker'
import PlanViewer from '../ui/plan/plan-viewer'
import type { UnitVisual } from '../ui/plan/plan-svg'
import Notice from '../ui/notice'
import SubmitButton from '../ui/submit-button'
import { joinWaitlistAction, reserveAction } from './booking-actions'
import { PendingPanel, SeatContactFields, WaitlistForm } from './booking-panel'
import type { BookingOptions } from './event-plan'

/**
 * Öffentliche Platzbuchung (Modus SEAT): Plätze wählen (Plan oder Liste, Vorschlag "N nebeneinander"),
 * Kontaktangaben, reservieren, dann Bestätigung per Code wie bei Tischen. Findet der Vorschlag keine N
 * Plätze nebeneinander, bietet die Seite die Warteliste an (Angebote gibt es nur für zusammenhängende
 * Plätze, docs/KONZEPT.md Abschnitt 5).
 */
export default function SeatBooking({ layout, backgroundUrl, title, seats, groups, maxSeats, largestGroup, booking }: {
  layout: Layout
  backgroundUrl: string | null
  title: string
  seats: PickerSeat[]
  groups: SeatGroup[]
  maxSeats: number
  /** So viele Plätze liegen höchstens überhaupt nebeneinander (größere Gruppen: keine Warteliste). */
  largestGroup: number
  booking: BookingOptions
}) {
  const [reserveState, reserve, reserving] = useActionState(reserveAction, null)
  const [waitlistState, joinWaitlist, joining] = useActionState(joinWaitlistAction, null)
  const [selected, setSelected] = useState<string[]>([])
  const [missing, setMissing] = useState<number | null>(null)
  const [waitlistOpen, setWaitlistOpen] = useState(false)

  if (!booking.open) {
    const visuals = new Map<string, UnitVisual>(seats.map(s => [s.key, { state: s.state === 'taken' ? 'confirmed' : s.state }]))
    const free = seats.filter(s => s.state === 'free').length
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-700">{free} von {seats.length} Plätzen frei.</p>
        <PlanViewer layout={layout} backgroundUrl={backgroundUrl} units={visuals} title={title} />
      </div>
    )
  }

  if (reserveState?.step === 'pending') {
    return (
      <PendingPanel bookingId={reserveState.bookingId} resendHint="Die Reservierung verlängert sich dadurch nicht.">
        <strong>{reserveState.placeLabel}</strong> {reserveState.placeLabel.includes('Plätze') ? 'sind' : 'ist'} bis {reserveState.expiresAtText} für dich reserviert.
        Wir haben eine Mail an <strong>{reserveState.email}</strong> geschickt – bitte bestätige deine Adresse mit dem Link oder dem Code aus
        der Mail. Ohne Bestätigung werden die Plätze danach wieder frei.
      </PendingPanel>
    )
  }
  if (waitlistState?.step === 'pending') {
    return (
      <PendingPanel bookingId={waitlistState.bookingId} resendHint="Die Frist verlängert sich dadurch nicht.">
        Wir haben eine Mail an <strong>{waitlistState.email}</strong> geschickt. Bitte bestätige deine Adresse bis {waitlistState.expiresAtText} mit
        dem Link oder dem Code aus der Mail – erst dann stehst du auf der Warteliste.
      </PendingPanel>
    )
  }

  const canWait = booking.waitlist && missing !== null && missing <= maxSeats && missing <= largestGroup
  return (
    <div className="space-y-4">
      <form action={reserve} className="space-y-4">
        <input type="hidden" name="eventId" value={booking.eventId} />
        <SeatPicker
          layout={layout} backgroundUrl={backgroundUrl} title={title} seats={seats} groups={groups} max={maxSeats}
          onChange={next => { setSelected(next); setWaitlistOpen(false) }}
          onNoSuggestion={setMissing}
        />
        {selected.length > 0 && (
          <div className="border-2 border-blue-200 rounded-lg p-4 space-y-3">
            <h2 className="font-bold text-lg">{selected.length} {selected.length === 1 ? 'Platz' : 'Plätze'} reservieren</h2>
            {reserveState?.step === 'form' && reserveState.errors.length > 0 && (
              <Notice tone="error"><ul className="list-disc list-inside">{reserveState.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>
            )}
            <SeatContactFields requirePhone={booking.requirePhone} />
            <SubmitButton disabled={reserving}>Plätze reservieren</SubmitButton>
            <p className="text-xs text-gray-600">
              Du bekommst eine Mail mit Link und Code. Erst mit deiner Bestätigung gilt die Buchung – bis dahin halten wir die Plätze kurz für dich frei.
            </p>
          </div>
        )}
      </form>

      {canWait && !waitlistOpen && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Trag dich für {missing} Plätze nebeneinander auf die Warteliste ein – werden sie frei, bekommst du ein Angebot per Mail.</span>
          <button type="button" onClick={() => setWaitlistOpen(true)} className="bg-blue-600 text-white font-bold py-1.5 px-3 rounded hover:bg-blue-700">Auf die Warteliste</button>
        </div>
      )}
      {missing !== null && !canWait && booking.waitlist && missing > largestGroup && (
        <p className="text-sm text-gray-700">So viele Plätze liegen nirgends nebeneinander.</p>
      )}
      {canWait && waitlistOpen && missing !== null && (
        <div className="border-2 border-blue-200 rounded-lg p-4">
          <WaitlistForm
            eventId={booking.eventId} partySize={missing} requirePhone={booking.requirePhone} action={joinWaitlist} pending={joining}
            errors={waitlistState?.step === 'form' ? waitlistState.errors : []} onClose={() => setWaitlistOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
