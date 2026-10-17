// app/admin/events/[id]/arrange/page.tsx
import { prisma } from '../../../../lib/prisma'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404, loadUnitStates } from '../../../../lib/events/store'
import { loadSeatingBoard } from '../../../../lib/events/assign'
import { loadMoveBoard } from '../../../../lib/events/admin-booking'
import { ADMIN_NOTE_MAX } from '../../../../lib/events/admin-rules'
import { BOOKING_LIMITS } from '../../../../lib/events/booking-rules'
import { MAX_PARTY } from '../../../../lib/events/assign-rules'
import { createPartyAction } from '../../arrange-actions'
import { AssignBoard, MoveBoard } from '../../../../ui/plan/arrange-board'
import ActionForm from '../../../../ui/action-form'
import { ButtonLink, buttonClass, hintClass, inputClass, labelClass as kitLabelClass, SettingsSection, SubmitButton } from '../../../../ui/kit'
import GuestImportForm from './guest-import-form'
import RsvpSyncPanel from '../../rsvp-sync-panel'
import { formatShort } from '../../../../lib/timezone'

export const dynamic = 'force-dynamic'

const input = inputClass
const labelClass = kitLabelClass

/**
 * Sitzordnung (Modus ASSIGNED: Gäste anlegen/importieren und auf Plätze setzen) bzw. Buchungen im Plan
 * verschieben (TABLE/SEAT) - docs/KONZEPT.md Abschnitt 8, Phase 6. Die Aktionen prüfen Konto und Event
 * selbst (app/admin/events/arrange-actions.ts); die Seite zeigt Namen nur Konten mit Zugriff.
 */
export default async function ArrangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/arrange`)
  const event = await loadEventOr404(id, user)
  const base = `/admin/events/${event.id}`
  const backgroundUrl = event.backgroundFile ? `${base}/background?v=${event.layoutVersion}-${event.backgroundFile.slice(0, 8)}` : null
  const assigned = event.mode === 'ASSIGNED'

  let board: React.ReactNode
  if (assigned) {
    const [{ parties, seats }, tables] = await Promise.all([
      loadSeatingBoard(event),
      prisma.unit.findMany({ where: { eventId: event.id, kind: 'TABLE' }, select: { key: true, label: true, capacity: true } })
    ])
    board = (
      <>
        <SettingsSection id="guests" title="Gäste hinzufügen" summary="von Hand oder per CSV" open={parties.length === 0}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="font-medium">Gruppe anlegen</h3>
              <ActionForm action={createPartyAction}>
                <input type="hidden" name="eventId" value={event.id} />
                <div>
                  <label htmlFor="party-persons" className={labelClass}>Personen (eine pro Zeile)</label>
                  <textarea id="party-persons" name="persons" required rows={4} className={input} placeholder={'Erika Muster\nMax Muster\nBegleitung von Max'} />
                </div>
                <div>
                  <label htmlFor="party-name" className={labelClass}>Name der Gruppe (optional)</label>
                  <input id="party-name" name="name" maxLength={BOOKING_LIMITS.name} className={input} placeholder="z. B. Familie Muster" />
                </div>
                <div>
                  <label htmlFor="party-note" className={labelClass}>Interne Notiz (optional)</label>
                  <textarea id="party-note" name="adminNote" maxLength={ADMIN_NOTE_MAX} rows={2} className={input} placeholder="z. B. vegetarisch, Kinderstuhl" />
                </div>
                <SubmitButton>Gruppe anlegen</SubmitButton>
                <p className={hintClass}>
                  Eine Gruppe sitzt möglichst zusammen (z. B. eine Einladung mit Begleitungen), höchstens {MAX_PARTY} Personen. Ohne
                  Gruppennamen heißt sie wie die erste Person. Kontaktdaten werden hier nicht erfasst.
                </p>
              </ActionForm>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Gästeliste importieren (CSV)</h3>
              <GuestImportForm eventId={event.id} />
            </div>
          </div>
        </SettingsSection>
        {event.rsvpEventId && (
          <SettingsSection id="rsvp-sync" title="Gäste aus rsvp-app" marker="pink" summary={event.rsvpChangedAt ? 'Änderungen gemeldet' : undefined} open={event.rsvpChangedAt !== null || parties.length === 0}>
            <RsvpSyncPanel eventId={event.id} assigned changedSince={event.rsvpChangedAt ? formatShort(event.rsvpChangedAt, event.timezone) : null} />
          </SettingsSection>
        )}
        <AssignBoard
          eventId={event.id} layout={event.layout} backgroundUrl={backgroundUrl} title={`Sitzordnung ${event.title}`}
          parties={parties} seats={seats} tables={tables}
        />
      </>
    )
  } else {
    const now = new Date()
    const kind = event.mode === 'SEAT' ? 'SEAT' : 'TABLE'
    const [bookings, { units, states }] = await Promise.all([loadMoveBoard(event.id, now), loadUnitStates(event.id, now)])
    const mailable = (await prisma.booking.findMany({
      where: { id: { in: bookings.map(b => b.id) }, status: 'CONFIRMED', email: { not: null } }, select: { id: true }
    })).map(b => b.id)
    board = (
      <MoveBoard
        eventId={event.id} mode={kind} layout={event.layout} backgroundUrl={backgroundUrl} title={`Plan ${event.title}`}
        bookings={bookings} mailable={mailable}
        units={units.filter(u => u.kind === kind).map(u => ({ key: u.key, label: u.label, state: states.get(u.key) ?? 'free' }))}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{assigned ? 'Sitzordnung' : 'Buchungen im Plan verschieben'}</h2>
        {assigned && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}/print`} size="sm">Tischliste drucken</ButtonLink>
            <ButtonLink href={`${base}/print?view=cards`} size="sm">Tischkarten</ButtonLink>
            <a href={`${base}/export`} className={buttonClass('secondary', 'sm')}>CSV-Export</a>
          </div>
        )}
      </div>
      {board}
    </div>
  )
}
