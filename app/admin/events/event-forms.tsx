// app/admin/events/event-forms.tsx
'use client'

import { useActionState, useState } from 'react'
import type { EventMode, EventStatus } from '@prisma/client'
import { createEvent, resyncEventFromTemplate, updateEventSettings, type FormState } from './actions'
import { suggestSlug, SLUG_MAX_LENGTH } from '../../lib/slugs'
import { AVAILABLE_MODES, EVENT_LIMITS, MODE_LABELS, STATUS_HINTS, STATUS_LABELS } from '../../lib/events/settings'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'

function Errors({ state }: { state: FormState }) {
  if (!state || state.errors.length === 0) return null
  return (
    <Notice tone="error">
      <ul className="list-disc list-inside">
        {state.errors.map((error, index) => <li key={index}>{error}</li>)}
      </ul>
    </Notice>
  )
}

const input = 'w-full border border-gray-300 p-2 rounded'
const labelClass = 'block text-sm font-medium mb-1'

export type EventFormValues = {
  title: string
  slug: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  mode: EventMode
  bookingOpensAt: string
  bookingClosesAt: string
  minFillPercent: string
  status: EventStatus
}

/** Titel + Adresse: Solange die Adresse nicht selbst geändert wurde, folgt sie dem Titel. */
function TitleAndSlug({ initialTitle, initialSlug, baseUrl }: { initialTitle: string; initialSlug: string; baseUrl: string }) {
  const [title, setTitle] = useState(initialTitle)
  const [slug, setSlug] = useState(initialSlug)
  const [slugTouched, setSlugTouched] = useState(initialSlug !== '')
  return (
    <>
      <div>
        <label htmlFor="event-title" className={labelClass}>Titel</label>
        <input
          id="event-title" name="title" required maxLength={EVENT_LIMITS.title} value={title} className={input}
          placeholder="z. B. Winterball 2026"
          onChange={event => {
            setTitle(event.currentTarget.value)
            if (!slugTouched) setSlug(suggestSlug(event.currentTarget.value))
          }}
        />
      </div>
      <div>
        <label htmlFor="event-slug" className={labelClass}>Adresse</label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-600 whitespace-nowrap">{baseUrl}/</span>
          <input
            id="event-slug" name="slug" required maxLength={SLUG_MAX_LENGTH} value={slug} className={input}
            pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="event-slug-hint"
            onChange={event => {
              setSlug(event.currentTarget.value)
              setSlugTouched(true)
            }}
          />
        </div>
        <p id="event-slug-hint" className="text-xs text-gray-600 mt-1">
          Kleinbuchstaben, Ziffern und Bindestriche. Ändert sich die Adresse später, funktionieren bereits verschickte Links nicht mehr.
        </p>
      </div>
    </>
  )
}

function ModeSelect({ value }: { value: EventMode }) {
  return (
    <div>
      <label htmlFor="event-mode" className={labelClass}>Art der Buchung</label>
      <select id="event-mode" name="mode" defaultValue={value} className={input}>
        {(Object.keys(MODE_LABELS) as EventMode[]).map(mode => (
          <option key={mode} value={mode} disabled={!AVAILABLE_MODES.includes(mode)}>
            {MODE_LABELS[mode]}{AVAILABLE_MODES.includes(mode) ? '' : ' (folgt)'}
          </option>
        ))}
      </select>
    </div>
  )
}

function Times({ values }: { values: Pick<EventFormValues, 'startsAt' | 'endsAt'> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="event-starts" className={labelClass}>Beginn</label>
        <input id="event-starts" name="startsAt" type="datetime-local" required defaultValue={values.startsAt} className={input} />
      </div>
      <div>
        <label htmlFor="event-ends" className={labelClass}>Ende</label>
        <input id="event-ends" name="endsAt" type="datetime-local" required defaultValue={values.endsAt} className={input} />
      </div>
    </div>
  )
}

function Details({ values }: { values: Pick<EventFormValues, 'location' | 'description'> }) {
  return (
    <>
      <div>
        <label htmlFor="event-location" className={labelClass}>Ort</label>
        <input id="event-location" name="location" maxLength={EVENT_LIMITS.location} defaultValue={values.location} className={input} placeholder="z. B. Festsaal, Hauptstraße 1" />
      </div>
      <div>
        <label htmlFor="event-description" className={labelClass}>Beschreibung</label>
        <textarea id="event-description" name="description" maxLength={EVENT_LIMITS.description} defaultValue={values.description} rows={5} className={input} />
        <p className="text-xs text-gray-600 mt-1">Erscheint auf der öffentlichen Seite als einfacher Text (Zeilenumbrüche bleiben erhalten).</p>
      </div>
    </>
  )
}

export function CreateEventForm({ plans, baseUrl }: { plans: { id: string; label: string }[]; baseUrl: string }) {
  const [state, action, pending] = useActionState(createEvent, null)
  return (
    <form action={action} className="space-y-4">
      <Errors state={state} />
      <TitleAndSlug initialTitle="" initialSlug="" baseUrl={baseUrl} />
      <div>
        <label htmlFor="event-plan" className={labelClass}>Raumplan (Vorlage)</label>
        <select id="event-plan" name="planId" required className={input} defaultValue="">
          <option value="" disabled>Bitte wählen …</option>
          {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
        </select>
        <p className="text-xs text-gray-600 mt-1">Der Plan wird kopiert. Den Plan des Events kannst du danach unabhängig von der Vorlage anpassen.</p>
      </div>
      <ModeSelect value="TABLE" />
      <Times values={{ startsAt: '', endsAt: '' }} />
      <Details values={{ location: '', description: '' }} />
      <SubmitButton disabled={pending}>Event anlegen</SubmitButton>
      <p className="text-xs text-gray-600">Neue Events sind zunächst ein Entwurf und öffentlich nicht sichtbar.</p>
    </form>
  )
}

export function EventSettingsForm({ eventId, values, baseUrl }: { eventId: string; values: EventFormValues; baseUrl: string }) {
  const [state, action, pending] = useActionState(updateEventSettings, null)
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <Errors state={state} />
      <div>
        <label htmlFor="event-status" className={labelClass}>Status</label>
        <select id="event-status" name="status" defaultValue={values.status} className={input}>
          {(Object.keys(STATUS_LABELS) as EventStatus[]).map(status => (
            <option key={status} value={status}>{STATUS_LABELS[status]} – {STATUS_HINTS[status]}</option>
          ))}
        </select>
      </div>
      <TitleAndSlug initialTitle={values.title} initialSlug={values.slug} baseUrl={baseUrl} />
      <ModeSelect value={values.mode} />
      <Times values={values} />
      <Details values={values} />
      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">Buchung</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="event-opens" className={labelClass}>Buchung ab (optional)</label>
            <input id="event-opens" name="bookingOpensAt" type="datetime-local" defaultValue={values.bookingOpensAt} className={input} />
          </div>
          <div>
            <label htmlFor="event-closes" className={labelClass}>Buchung bis (optional)</label>
            <input id="event-closes" name="bookingClosesAt" type="datetime-local" defaultValue={values.bookingClosesAt} className={input} />
          </div>
        </div>
        <div>
          <label htmlFor="event-minfill" className={labelClass}>Mindestbelegung eines Tisches in % (optional)</label>
          <input id="event-minfill" name="minFillPercent" type="number" min={1} max={100} step={1} defaultValue={values.minFillPercent} className={input} />
          <p className="text-xs text-gray-600 mt-1">
            Beispiel 50: Ein 8er-Tisch ist erst ab 4 Personen buchbar. Leer lassen, wenn jede Gruppe jeden ausreichend großen Tisch nehmen darf.
          </p>
        </div>
      </fieldset>
      <SubmitButton disabled={pending}>Einstellungen speichern</SubmitButton>
    </form>
  )
}

/** "Plan aus Vorlage neu übernehmen" - mit Rückfrage, Fehler (z.B. belegte Tische) kommen als Liste zurück. */
export function ResyncForm({ eventId, layoutVersion, planName }: { eventId: string; layoutVersion: number; planName: string }) {
  const [state, action, pending] = useActionState(resyncEventFromTemplate, null)
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={event => {
        if (!confirm(`Plan und Hintergrundbild aus der Vorlage „${planName}“ neu übernehmen? Änderungen am Plan dieses Events gehen dabei verloren.`)) event.preventDefault()
      }}
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="layoutVersion" value={layoutVersion} />
      <Errors state={state} />
      <button type="submit" disabled={pending} className="text-sm text-blue-700 hover:underline disabled:opacity-50">
        Plan aus Vorlage neu übernehmen
      </button>
    </form>
  )
}
