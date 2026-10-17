// app/admin/events/event-forms.tsx
'use client'

import { useActionState, useState } from 'react'
import type { BookingAccess, EventMode } from '@prisma/client'
import { createEvent, resyncEventFromTemplate, updateEventSettings, type FormState } from './actions'
import { suggestSlug, SLUG_MAX_LENGTH } from '../../lib/slugs'
import { ACCESS_LABELS, AVAILABLE_MODES, EVENT_LIMITS, MODE_HINTS, MODE_LABELS } from '../../lib/events/settings'
import CopyableField from '../../ui/copyable-field'
import { PENDING_TTL_RANGE, SELF_EDIT_HOURS_MAX } from '../../lib/events/booking-rules'
import { OFFER_TTL_RANGE } from '../../lib/events/waitlist-rules'
import { MAX_SEATS_RANGE } from '../../lib/events/seat-rules'
import SubmitButton from '../../ui/submit-button'
import Notice from '../../ui/notice'
import { buttonClass, hintClass, inputClass, labelClass, SettingsSection } from '../../ui/kit'

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

const input = inputClass
const checkboxLabel = 'flex items-start gap-2 text-sm'

export type EventFormValues = {
  title: string
  slug: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  mode: EventMode
  access: BookingAccess
  rsvpEventId: string
  bookingOpensAt: string
  bookingClosesAt: string
  minFillPercent: string
  pendingTtlMinutes: number
  selfEditHoursBefore: number
  oneBookingPerEmail: boolean
  requirePhone: boolean
  waitlistEnabled: boolean
  offerTtlHours: number
  maxSeatsPerBooking: number
  replyTo: string
  mailNote: string
  guestSeatingVisible: boolean
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
          <span className="hidden text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap sm:inline">{baseUrl}/</span>
          <input
            id="event-slug" name="slug" required maxLength={SLUG_MAX_LENGTH} value={slug} className={input}
            pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="event-slug-hint"
            onChange={event => {
              setSlug(event.currentTarget.value)
              setSlugTouched(true)
            }}
          />
        </div>
        <p id="event-slug-hint" className={hintClass}>
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
      <ul className={hintClass}>
        {AVAILABLE_MODES.map(mode => <li key={mode}>{MODE_LABELS[mode]}: {MODE_HINTS[mode]}</li>)}
      </ul>
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
        <p className={hintClass}>Erscheint auf der öffentlichen Seite als einfacher Text (Zeilenumbrüche bleiben erhalten).</p>
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
        <p className={hintClass}>Der Plan wird kopiert. Den Plan des Events kannst du danach unabhängig von der Vorlage anpassen.</p>
      </div>
      <ModeSelect value="TABLE" />
      <Times values={{ startsAt: '', endsAt: '' }} />
      <Details values={{ location: '', description: '' }} />
      <SubmitButton disabled={pending}>Event anlegen</SubmitButton>
      <p className={hintClass}>Neue Events sind zunächst ein Entwurf und öffentlich nicht sichtbar.</p>
    </form>
  )
}

/**
 * Anbindung an rsvp-app (Phase 7): Zugang (nur Tisch-/Platzbuchung) und die id des rsvp-Termins. Der
 * Sitzplatz-Link muss zusätzlich in rsvp-app eingetragen werden - erst dann gilt die Verknüpfung.
 */
function RsvpFields({ values, rsvp }: { values: Pick<EventFormValues, 'access' | 'rsvpEventId' | 'mode' | 'guestSeatingVisible'>; rsvp: { available: boolean; seatingLink: string } }) {
  return (
    <>
      {!rsvp.available && (
        <p className={hintClass}>Die Anbindung an rsvp-app ist auf diesem Server nicht eingerichtet (RSVP_SEATING_SECRET, RSVP_APP_BASE_URL).</p>
      )}
      <div>
        <label htmlFor="event-access" className={labelClass}>Wer darf buchen? (nur Tisch- und Platzbuchung)</label>
        <select id="event-access" name="access" defaultValue={values.access === 'RSVP' ? 'RSVP' : 'OPEN'} className={input}>
          <option value="OPEN">{ACCESS_LABELS.OPEN}</option>
          <option value="RSVP" disabled={!rsvp.available && values.access !== 'RSVP'}>{ACCESS_LABELS.RSVP}</option>
        </select>
        <p className={hintClass}>Bei einer Sitzordnung bucht niemand selbst – dort dient die Verknüpfung dem Abgleich der Gästeliste.</p>
      </div>
      <div>
        <label htmlFor="event-rsvp" className={labelClass}>rsvp-app-Event-ID (id des Termins in rsvp-app)</label>
        <input id="event-rsvp" name="rsvpEventId" maxLength={40} defaultValue={values.rsvpEventId} className={`${input} font-mono`} placeholder="z. B. cm1a2b3c4d5e6f7g8h9" />
      </div>
      {values.rsvpEventId && (
        <div className="space-y-1">
          <CopyableField label="Sitzplatz-Link – in rsvp-app beim Termin eintragen" value={rsvp.seatingLink} />
          <p className={hintClass}>Erst wenn beide Seiten eingetragen sind, gilt die Verknüpfung (Platzwahl, Gästeliste, Rückmeldung der Plätze).</p>
        </div>
      )}
      <label className={checkboxLabel}>
        <input type="checkbox" name="guestSeatingVisible" defaultChecked={values.guestSeatingVisible} className="mt-1" />
        <span>
          Sitzordnung mit Namen für Gäste mit Zusage zeigen (nur Sitzordnung)
          <span className={`block ${hintClass}`}>
            Wer über „Sitzplatz“ bei seiner Zusage in rsvp-app kommt, sieht seinen Platz und wer an welchem Tisch sitzt – nur Namen
            und Plätze. Die öffentliche Eventseite zeigt nie Namen.
          </span>
        </span>
      </label>
    </>
  )
}


/**
 * Einstellungen eines Events (docs/KONZEPT-OBERFLAECHE.md) in einklappbaren Abschnitten mit Kurzstand. Anders als in
 * Zeitplan ein einziges Formular: Die Felder werden zusammen geprüft (parseEventForm, z. B. Buchungszeitraum gegen
 * Beginn, Zugang gegen rsvp-Verknüpfung). Zugeklappte Abschnitte bleiben im DOM und werden mitgeschickt; die
 * Speichern-Leiste bleibt beim Scrollen unten sichtbar. Den Status ändern die Knöpfe in der Übersicht.
 */
export function EventSettingsForm({ eventId, values, baseUrl, rsvp, open }: {
  eventId: string; values: EventFormValues; baseUrl: string; rsvp: { available: boolean; seatingLink: string }; open?: string
}) {
  const [state, action, pending] = useActionState(updateEventSettings, null)
  const bookingWindow = [values.bookingOpensAt && 'mit Start', values.bookingClosesAt && 'mit Schluss'].filter(Boolean).join(', ')
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="eventId" value={eventId} />
      <Errors state={state} />
      <SettingsSection id="event" title="Event" summary={MODE_LABELS[values.mode]} open={open === 'event'}>
        <TitleAndSlug initialTitle={values.title} initialSlug={values.slug} baseUrl={baseUrl} />
        <ModeSelect value={values.mode} />
        <Times values={values} />
        <Details values={values} />
      </SettingsSection>
      <SettingsSection id="booking" title="Buchung" summary={bookingWindow ? `Zeitraum ${bookingWindow}` : 'ohne Zeitraum'} open={open === 'booking'}
        description="Gilt für Tisch- und Platzbuchung (bei einer Sitzordnung bucht niemand selbst).">
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
          <input id="event-minfill" name="minFillPercent" type="number" inputMode="numeric" min={1} max={100} step={1} defaultValue={values.minFillPercent} className={input} />
          <p className={hintClass}>
            Beispiel 50: Ein 8er-Tisch ist erst ab 4 Personen buchbar. Leer lassen, wenn jede Gruppe jeden ausreichend großen Tisch nehmen darf.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="event-ttl" className={labelClass}>Reservierung ohne Bestätigung (Minuten)</label>
            <input id="event-ttl" name="pendingTtlMinutes" type="number" inputMode="numeric" required min={PENDING_TTL_RANGE.min} max={PENDING_TTL_RANGE.max} defaultValue={values.pendingTtlMinutes} className={input} />
          </div>
          <div>
            <label htmlFor="event-selfedit" className={labelClass}>Selbst ändern bis (Stunden vor Beginn)</label>
            <input id="event-selfedit" name="selfEditHoursBefore" type="number" inputMode="numeric" required min={0} max={SELF_EDIT_HOURS_MAX} defaultValue={values.selfEditHoursBefore} className={input} />
          </div>
        </div>
        <p className={hintClass}>
          So lange hält eine unbestätigte Reservierung ihren Tisch. Bestätigte Buchungen können die Buchenden bis zur
          Änderungsfrist selbst ändern und stornieren (0 = bis Beginn).
        </p>
        <label className={checkboxLabel}>
          <input type="checkbox" name="oneBookingPerEmail" defaultChecked={values.oneBookingPerEmail} className="mt-1" />
          <span>Pro E-Mail-Adresse nur eine Buchung<span className={`block ${hintClass}`}>Abschalten, wenn z. B. Vereine mehrere Tische buchen sollen.</span></span>
        </label>
        <label className={checkboxLabel}>
          <input type="checkbox" name="requirePhone" defaultChecked={values.requirePhone} className="mt-1" />
          <span>Telefonnummer verpflichtend</span>
        </label>
        <div>
          <label htmlFor="event-maxseats" className={labelClass}>Plätze pro Buchung höchstens (nur bei Einzelplätzen)</label>
          <input id="event-maxseats" name="maxSeatsPerBooking" type="number" inputMode="numeric" required min={MAX_SEATS_RANGE.min} max={MAX_SEATS_RANGE.max} defaultValue={values.maxSeatsPerBooking} className={input} />
        </div>
      </SettingsSection>
      <SettingsSection id="waitlist" title="Warteliste" summary={values.waitlistEnabled ? 'an' : 'aus'} marker="blue" open={open === 'waitlist'}>
        <label className={checkboxLabel}>
          <input type="checkbox" name="waitlistEnabled" defaultChecked={values.waitlistEnabled} className="mt-1" />
          <span>
            Warteliste
            <span className={`block ${hintClass}`}>
              Ist kein passender Tisch frei, können sich Gruppen eintragen. Wird ein Tisch frei, bekommt der am längsten wartende passende
              Eintrag ein befristetes Angebot per Mail.
            </span>
          </span>
        </label>
        <div>
          <label htmlFor="event-offerttl" className={labelClass}>Angebot aus der Warteliste gilt (Stunden)</label>
          <input id="event-offerttl" name="offerTtlHours" type="number" inputMode="numeric" required min={OFFER_TTL_RANGE.min} max={OFFER_TTL_RANGE.max} defaultValue={values.offerTtlHours} className={input} />
          <p className={hintClass}>Höchstens bis Buchungsschluss. So lange ist der Tisch für die Gruppe reserviert.</p>
        </div>
      </SettingsSection>
      <SettingsSection id="mails" title="Mails an Buchende" summary={values.replyTo || values.mailNote ? 'angepasst' : 'Standard'} open={open === 'mails'}>
        <div>
          <label htmlFor="event-replyto" className={labelClass}>Antwortadresse für Buchungsmails (optional)</label>
          <input id="event-replyto" name="replyTo" type="email" maxLength={254} defaultValue={values.replyTo} className={input} />
        </div>
        <div>
          <label htmlFor="event-mailnote" className={labelClass}>Hinweis in der Bestätigungsmail (optional)</label>
          <textarea id="event-mailnote" name="mailNote" maxLength={EVENT_LIMITS.mailNote} rows={3} defaultValue={values.mailNote} className={input} placeholder="z. B. Einlass ab 18:30 Uhr, bitte Buchungsbestätigung bereithalten." />
        </div>
      </SettingsSection>
      <SettingsSection id="rsvp" title="Zugang und rsvp-app" marker="pink" open={open === 'rsvp'}
        summary={values.access === 'RSVP' ? 'nur mit Zusage' : values.rsvpEventId ? 'verknüpft' : 'jede*r mit Link'}>
        <RsvpFields values={values} rsvp={rsvp} />
      </SettingsSection>
      <div className="sticky bottom-0 z-10 -mx-4 bg-gray-50/95 px-4 py-3 backdrop-blur dark:bg-gray-900/95">
        <SubmitButton disabled={pending}>Einstellungen speichern</SubmitButton>
      </div>
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
      <button type="submit" disabled={pending} className={buttonClass('secondary', 'sm')}>
        Plan aus Vorlage neu übernehmen
      </button>
    </form>
  )
}
