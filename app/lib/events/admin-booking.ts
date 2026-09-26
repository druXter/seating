// app/lib/events/admin-booking.ts
import type { Booking, Event } from '@prisma/client'
import { prisma } from '../prisma'
import { newVerifyCode, newVerifyToken } from '../booking-tokens'
import { sendCancelledMail, sendChangedMail, sendConfirmedMail, sendManageLinkMail, sendVerifyMail } from '../booking-mail'
import { holdsUnits } from './occupancy'
import { tableOf } from './booking'
import { activeWhere, audit, isUniqueViolation, lockEvent, releaseStaleHolds, tableSeatsTaken, type Tx } from './booking-tx'
import { auditDiff, calendarRelevant, changeLabels, changeRows, diffBooking } from './booking-changes'
import { adminTableProblem, byLabel, type AdminChangeInput, type AdminCreateInput } from './admin-rules'
import { loadUnitStates } from './store'
import type { AuditContext } from './audit-text'

/**
 * Buchungsverwaltung durch Veranstalter*innen (docs/KONZEPT.md Abschnitt 8). Die Berechtigung prüfen
 * die Server Actions (app/admin/events/booking-actions.ts) VOR jedem Aufruf: Konto mit Zugriff auf
 * das Event (loadEventForUser) und eine Buchung GENAU dieses Events (loadAdminBooking). actor ist die
 * Konto-id fürs Audit-Log.
 *
 * Wie bei Buchenden verhindert der Unique-Index Allocation(eventId, unitId) die Doppelbuchung. Änderungen
 * bauen auf einem Stand auf (Booking.updatedAt): Hat die Kund*in oder ein anderes Konto die Buchung
 * inzwischen geändert, wird nicht still überschrieben.
 */

type Table = { id: string; key: string; label: string; capacity: number }
/** Event ohne Plan - Server Actions reichen das geladene Event (mit geprüftem Plan) herein. */
type AdminEvent = Omit<Event, 'layout'>
export type AdminBooking = Booking & { table: Table | null }

export type AdminResult = { ok: true; changed: boolean; mailFailed: boolean; bookingId?: string } | { ok: false; errors: string[] }

const CONFLICT = 'Die Buchung wurde inzwischen geändert (von der Kund*in oder einem anderen Konto). Bitte lade die Seite neu und prüfe die Angaben.'
const INACTIVE = 'Diese Buchung ist nicht mehr aktiv.'

/** Rollt eine Transaktion zurück und trägt die Meldung nach außen. */
class Abort extends Error {}

function done(mailFailed = false, changed = true): AdminResult {
  return { ok: true, changed, mailFailed }
}

function fail(...errors: string[]): AdminResult {
  return { ok: false, errors }
}

/** Buchung eines Events - null, wenn es sie nicht gibt ODER sie zu einem anderen Event gehört. */
export async function loadAdminBooking(eventId: string, bookingId: string): Promise<AdminBooking | null> {
  if (!/^[a-z0-9]{10,40}$/.test(bookingId)) return null
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, eventId } })
  return booking ? { ...booking, table: await tableOf(booking.id) } : null
}

/** Zieltisch: jeder Tisch des Events, auch ein nicht buchbarer (z.B. für Ehrengäste freigehalten). */
function findTable(eventId: string, key: string) {
  return prisma.unit.findFirst({ where: { eventId, key, kind: 'TABLE' }, select: { id: true, key: true, label: true, capacity: true } })
}

/**
 * Tischwechsel innerhalb einer Transaktion: abgelaufene Holds auf dem Ziel freigeben, gemischte
 * Belegung prüfen, alte Allocation weg, neue rein (Unique-Index greift bei gleichzeitiger Vergabe).
 */
async function moveAllocation(tx: Tx, eventId: string, bookingId: string, target: Table, now: Date) {
  await releaseStaleHolds(tx, eventId, [target.id], now)
  if (await tableSeatsTaken(tx, eventId, target.key, now, bookingId)) throw new Abort(`${target.label} ist belegt.`)
  await tx.allocation.deleteMany({ where: { bookingId } })
  await tx.allocation.create({ data: { eventId, unitId: target.id, bookingId } })
}

function takenMessage(error: unknown, label: string): string | null {
  if (error instanceof Abort) return error.message
  if (isUniqueViolation(error)) return `${label} ist belegt.`
  return null
}

/** Kontakt, Personenzahl, Tisch. Mail mit Gegenüberstellung alt -> neu nur an bestätigte Buchungen. */
export async function adminChangeBooking(
  event: AdminEvent, booking: AdminBooking, input: AdminChangeInput, expected: Date, notify: boolean, actor: string, now = new Date()
): Promise<AdminResult> {
  if (!holdsUnits(booking, now)) return fail(INACTIVE)
  const target = input.unitKey === booking.table?.key ? booking.table : await findTable(event.id, input.unitKey)
  if (!target) return fail('Diesen Tisch gibt es nicht.')
  const problem = adminTableProblem(target, input.partySize)
  if (problem) return fail(problem)

  const changes = diffBooking(
    { name: booking.name, phone: booking.phone, note: booking.note, partySize: booking.partySize, tableKey: booking.table?.key ?? null },
    { ...input, tableKey: target.key }
  )
  if (changes.length === 0) return done(false, false)
  const mail = notify && booking.status === 'CONFIRMED' && booking.email !== null

  try {
    await prisma.$transaction(async tx => {
      // Bedingtes Update ZUERST: schreibt (sperrt) und erkennt einen veralteten Stand.
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status, updatedAt: expected },
        data: {
          name: input.name, phone: input.phone, note: input.note, partySize: input.partySize,
          ...(calendarRelevant(changes) ? { icsSequence: { increment: 1 } } : {})
        }
      })
      if (claimed.count === 0) throw new Abort(CONFLICT)
      if (target.id !== booking.table?.id) await moveAllocation(tx, event.id, booking.id, target, now)
      await audit(tx, { eventId: event.id, bookingId: booking.id, actor, action: 'changed', diff: { ...auditDiff(changes), notified: mail } })
    })
  } catch (error) {
    const message = takenMessage(error, target.label)
    if (message) return fail(message)
    throw error
  }

  if (!mail) return done()
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  const labelOf = (key: string) => (key === target.key ? target.label : key === booking.table?.key ? booking.table.label : key)
  const sent = await sendChangedMail(event, updated, target.label, changeLabels(changes), changeRows(changes, labelOf), true)
  return done(!sent)
}

/** Interne Notiz - nie in Mails, nie für Buchende sichtbar, löst nichts aus. */
export async function adminSetNote(booking: AdminBooking, adminNote: string | null, actor: string): Promise<AdminResult> {
  if (adminNote === booking.adminNote) return done(false, false)
  await prisma.booking.update({ where: { id: booking.id }, data: { adminNote } })
  await audit(prisma, { eventId: booking.eventId, bookingId: booking.id, actor, action: 'note' })
  return done()
}

/**
 * Storno (bestätigt, unbestätigt, Eintrag auf der Warteliste oder offenes Angebot - Letztere enden
 * damit). Mail mit .ics (CANCEL) nur an bestätigte Buchungen. Einen frei gewordenen Tisch bietet die
 * aufrufende Action der Warteliste an.
 */
export async function adminCancelBooking(event: AdminEvent, booking: AdminBooking, notify: boolean, actor: string, now = new Date()): Promise<AdminResult> {
  if (!['CONFIRMED', 'PENDING', 'WAITLISTED', 'OFFERED'].includes(booking.status)) return fail(INACTIVE)
  const mail = notify && booking.status === 'CONFIRMED' && booking.email !== null
  const cancelled = await prisma.$transaction(async tx => {
    const result = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: {
        status: 'CANCELLED', cancelledAt: now, expiresAt: null, icsSequence: { increment: 1 },
        verifyTokenHash: null, verifyCodeHmac: null, pendingIpHash: null
      }
    })
    if (result.count === 0) return false
    await tx.allocation.deleteMany({ where: { bookingId: booking.id } })
    await audit(tx, { eventId: event.id, bookingId: booking.id, actor, action: 'cancelled', diff: { table: booking.table?.key ?? null, notified: mail } })
    return true
  })
  if (!cancelled) return fail(CONFLICT)
  if (!mail) return done()
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  return done(!(await sendCancelledMail(event, updated, booking.table?.label ?? 'Tisch', true)))
}

/**
 * Endgültig löschen (z.B. auf Wunsch der Person). Mit der Buchung verschwinden auch ihre Mail- und
 * Audit-Einträge; übrig bleibt ein Eintrag am Event ohne Personendaten. Eine bestätigte Buchung
 * bekommt vorher auf Wunsch die Stornomail.
 */
export async function adminDeleteBooking(event: AdminEvent, booking: AdminBooking, notify: boolean, actor: string, now = new Date()): Promise<AdminResult> {
  let mailFailed = false
  const mail = notify && booking.status === 'CONFIRMED' && booking.email !== null
  if (mail) {
    const updated = await prisma.booking.update({ where: { id: booking.id }, data: { icsSequence: { increment: 1 } } })
    mailFailed = !(await sendCancelledMail(event, updated, booking.table?.label ?? 'Tisch', true))
  }
  const deleted = await prisma.$transaction(async tx => {
    const result = await tx.booking.deleteMany({ where: { id: booking.id, eventId: event.id } })
    if (result.count === 0) return false
    await audit(tx, {
      eventId: event.id, bookingId: null, actor, action: 'deleted',
      diff: { table: booking.table?.key ?? null, partySize: booking.partySize, status: holdsUnits(booking, now) ? booking.status : 'EXPIRED', notified: mail }
    })
    return true
  })
  return deleted ? done(mailFailed) : fail('Diese Buchung gibt es nicht mehr.')
}

/**
 * Unbestätigte Buchung von Hand bestätigen (z.B. Person hat angerufen) oder ein offenes Angebot aus
 * der Warteliste für die Gruppe annehmen. emailVerifiedAt bleibt, wie es ist - bei einer unbestätigten
 * Reservierung also leer, die Adresse hat niemand bestätigt.
 */
export async function adminConfirmBooking(event: AdminEvent, booking: AdminBooking, notify: boolean, actor: string, now = new Date()): Promise<AdminResult> {
  const result = await prisma.booking.updateMany({
    where: { id: booking.id, status: { in: ['PENDING', 'OFFERED'] }, expiresAt: { gt: now } },
    data: { status: 'CONFIRMED', expiresAt: null, verifyTokenHash: null, verifyCodeHmac: null, verifyAttempts: 0, pendingIpHash: null }
  })
  if (result.count === 0) return fail('Nur unbestätigte Buchungen und offene Angebote lassen sich bestätigen.')
  const mail = notify && booking.email !== null
  await audit(prisma, { eventId: event.id, bookingId: booking.id, actor, action: 'confirmed', diff: { notified: mail } })
  if (!mail) return done()
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  return done(!(await sendConfirmedMail(event, updated, booking.table?.label ?? 'Tisch')))
}

/**
 * Neuer Link und Code (alter ungültig, Versuchszähler 0), an die bisherige oder - bei einem
 * Tippfehler - an eine korrigierte Adresse. renew: Frist beginnt neu (Konzept Abschnitte 5 und 8).
 * Ohne renew nur, solange die Reservierung noch gilt. Ist sie schon abgelaufen, aber noch nicht
 * aufgeräumt (Status PENDING), hält sie ihren Tisch weiterhin per Allocation - dann darf renew sie
 * wiederbeleben; wurde der Tisch inzwischen vergeben, ist sie längst EXPIRED.
 */
async function reissueVerification(
  event: AdminEvent, booking: AdminBooking, options: { renew: boolean; newEmail?: string }, actor: string, now: Date
): Promise<AdminResult> {
  if (booking.status !== 'PENDING') return fail('Nur bei unbestätigten Buchungen – bestätigte Adressen lassen sich nicht ändern.')
  if (!options.renew && !holdsUnits(booking, now)) return fail('Die Reservierung ist abgelaufen. Wähle „Frist neu beginnen“, um sie zu verlängern.')
  const email = options.newEmail ?? booking.email
  if (!email) return fail('Diese Buchung hat keine E-Mail-Adresse.')

  const verify = newVerifyToken()
  const code = newVerifyCode(booking.id)
  const expiresAt = options.renew ? new Date(now.getTime() + event.pendingTtlMinutes * 60 * 1000) : booking.expiresAt!
  try {
    await prisma.$transaction(async tx => {
      await lockEvent(tx, event.id)
      if (options.newEmail && event.oneBookingPerEmail) {
        const existing = await tx.booking.findFirst({ where: { eventId: event.id, email: options.newEmail, id: { not: booking.id }, ...activeWhere(now) }, select: { id: true } })
        if (existing) throw new Abort('Für diese Adresse gibt es schon eine aktive Buchung (eine Buchung pro Adresse, siehe Einstellungen).')
      }
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: 'PENDING' },
        data: { email, verifyTokenHash: verify.hash, verifyCodeHmac: code.hmac, verifyAttempts: 0, expiresAt }
      })
      if (updated.count === 0) throw new Abort(CONFLICT)
      await audit(tx, options.newEmail
        ? { eventId: event.id, bookingId: booking.id, actor, action: 'email-corrected', diff: { email: { from: booking.email, to: options.newEmail }, renewedExpiry: options.renew } }
        : { eventId: event.id, bookingId: booking.id, actor, action: 'verification-resent', diff: { renewedExpiry: options.renew } })
    })
  } catch (error) {
    if (error instanceof Abort) return fail(error.message)
    throw error
  }
  const sent = await sendVerifyMail(event, { ...booking, email }, booking.table?.label ?? 'Tisch', verify.token, code.code, expiresAt)
  return done(!sent)
}

export function adminResendVerification(event: AdminEvent, booking: AdminBooking, renew: boolean, actor: string, now = new Date()) {
  return reissueVerification(event, booking, { renew }, actor, now)
}

/**
 * Tippfehler in der Adresse einer UNBESTÄTIGTEN Buchung korrigieren (Entscheidung 13 Nr. 3). Keine
 * Mail an die alte Adresse - sie gehört vermutlich jemand anderem. Buchungen aus rsvp-app nie.
 */
export function adminCorrectEmail(event: AdminEvent, booking: AdminBooking, newEmail: string, renew: boolean, actor: string, now = new Date()) {
  if (booking.source === 'RSVP') return Promise.resolve(fail('Die Adresse kommt aus rsvp-app und lässt sich hier nicht ändern.'))
  if (newEmail === booking.email) return Promise.resolve(fail('Das ist dieselbe Adresse.'))
  return reissueVerification(event, booking, { renew, newEmail }, actor, now)
}

/**
 * Eintrag der Warteliste direkt auf einen freien Tisch setzen - auch am Nachrück-Verfahren vorbei
 * (Konzept Abschnitt 5, Schritt 4). Sofort bestätigt; Bestätigungsmail mit .ics auf Wunsch.
 */
export async function adminAssignWaitlist(
  event: AdminEvent, booking: AdminBooking, unitKey: string, notify: boolean, actor: string, now = new Date()
): Promise<AdminResult> {
  if (booking.status !== 'WAITLISTED') return fail('Dieser Eintrag steht nicht mehr auf der Warteliste.')
  const target = await findTable(event.id, unitKey)
  if (!target) return fail('Diesen Tisch gibt es nicht.')
  const problem = adminTableProblem(target, booking.partySize)
  if (problem) return fail(problem)
  try {
    await prisma.$transaction(async tx => {
      await lockEvent(tx, event.id)
      const updated = await tx.booking.updateMany({
        where: { id: booking.id, status: 'WAITLISTED' },
        data: { status: 'CONFIRMED', expiresAt: null, verifyTokenHash: null, verifyCodeHmac: null, verifyAttempts: 0 }
      })
      if (updated.count === 0) throw new Abort(CONFLICT)
      await moveAllocation(tx, event.id, booking.id, target, now)
      await audit(tx, { eventId: event.id, bookingId: booking.id, actor, action: 'assigned', diff: { table: target.key, notified: notify && booking.email !== null } })
    })
  } catch (error) {
    const message = takenMessage(error, target.label)
    if (message) return fail(message)
    throw error
  }
  if (!notify || !booking.email) return done()
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  return done(!(await sendConfirmedMail(event, updated, target.label)))
}

/** Verwaltungslink neu erzeugen: Version + 1, der alte Link (auch in Kalendereinträgen) ist ungültig. */
export async function adminRenewManageLink(event: AdminEvent, booking: AdminBooking, notify: boolean, actor: string): Promise<AdminResult> {
  const result = await prisma.booking.updateMany({ where: { id: booking.id, status: 'CONFIRMED' }, data: { manageTokenVersion: { increment: 1 } } })
  if (result.count === 0) return fail('Nur bestätigte Buchungen haben einen Verwaltungslink.')
  const mail = notify && booking.email !== null
  await audit(prisma, { eventId: event.id, bookingId: booking.id, actor, action: 'manage-link-renewed', diff: { notified: mail } })
  if (!mail) return done()
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  return done(!(await sendManageLinkMail(event, updated, booking.table?.label ?? 'Tisch')))
}

/**
 * Buchung anlegen (source ADMIN), z.B. telefonische Reservierung. "direct": sofort bestätigt,
 * Bestätigungsmail auf Wunsch; "verify": wie online - PENDING mit Frist und Verifizierungsmail.
 * oneBookingPerEmail gilt auch hier (wer mehrere Buchungen je Adresse will, schaltet es ab).
 */
export async function adminCreateBooking(event: AdminEvent, input: AdminCreateInput, actor: string, now = new Date()): Promise<AdminResult> {
  const target = await findTable(event.id, input.unitKey)
  if (!target) return fail('Diesen Tisch gibt es nicht.')
  const problem = adminTableProblem(target, input.partySize)
  if (problem) return fail(problem)

  const pending = input.confirm === 'verify'
  const verify = pending ? newVerifyToken() : null
  const expiresAt = pending ? new Date(now.getTime() + event.pendingTtlMinutes * 60 * 1000) : null
  let booking: Booking
  try {
    booking = await prisma.$transaction(async tx => {
      await lockEvent(tx, event.id)
      await releaseStaleHolds(tx, event.id, [target.id], now)
      if (await tableSeatsTaken(tx, event.id, target.key, now)) throw new Abort(`${target.label} ist belegt.`)
      if (input.email && event.oneBookingPerEmail) {
        const existing = await tx.booking.findFirst({ where: { eventId: event.id, email: input.email, ...activeWhere(now) }, select: { id: true } })
        if (existing) throw new Abort('Für diese Adresse gibt es schon eine aktive Buchung (eine Buchung pro Adresse, siehe Einstellungen).')
      }
      const created = await tx.booking.create({
        data: {
          eventId: event.id, status: pending ? 'PENDING' : 'CONFIRMED', source: 'ADMIN', name: input.name, email: input.email,
          phone: input.phone, note: input.note, adminNote: input.adminNote, partySize: input.partySize, expiresAt,
          verifyTokenHash: verify?.hash ?? null, allocations: { create: { eventId: event.id, unitId: target.id } }
        }
      })
      await audit(tx, {
        eventId: event.id, bookingId: created.id, actor, action: 'created',
        diff: { table: target.key, partySize: input.partySize, notified: pending || (input.notify && input.email !== null) }
      })
      return created
    })
  } catch (error) {
    const message = takenMessage(error, target.label)
    if (message) return fail(message)
    throw error
  }

  let mailFailed = false
  if (verify && expiresAt) {
    const code = newVerifyCode(booking.id)
    booking = await prisma.booking.update({ where: { id: booking.id }, data: { verifyCodeHmac: code.hmac } })
    mailFailed = !(await sendVerifyMail(event, booking, target.label, verify.token, code.code, expiresAt))
  } else if (input.notify && input.email) {
    mailFailed = !(await sendConfirmedMail(event, booking, target.label))
  }
  return { ok: true, changed: true, mailFailed, bookingId: booking.id }
}

export type TableChoice = { key: string; label: string; capacity: number; bookable: boolean }

/**
 * Tische, auf die Veranstalter*innen eine Buchung setzen können: der aktuelle und alle freien - auch
 * nicht buchbare (die gelten öffentlich als "nicht buchbar", sind aber frei).
 */
export async function tableChoices(eventId: string, currentKey: string | null, now = new Date()): Promise<TableChoice[]> {
  const { units, states } = await loadUnitStates(eventId, now)
  return units
    .filter(unit => unit.kind === 'TABLE' && (unit.key === currentKey || states.get(unit.key) === 'free' || states.get(unit.key) === 'unavailable'))
    .map(unit => ({ key: unit.key, label: unit.label, capacity: unit.capacity, bookable: unit.bookable }))
    .sort(byLabel)
}

/** Konto-E-Mails und aktuelle Tischnamen für die Anzeige des Audit-Logs (app/lib/events/audit-text.ts). */
export async function loadAuditContext(eventId: string, actors: string[]): Promise<AuditContext> {
  const ids = [...new Set(actors.filter(actor => actor !== 'customer' && actor !== 'system'))]
  const [users, units] = await Promise.all([
    ids.length > 0 ? prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : Promise.resolve([]),
    prisma.unit.findMany({ where: { eventId }, select: { key: true, label: true } })
  ])
  const emails = new Map(users.map(u => [u.id, u.email]))
  const labels = new Map(units.map(u => [u.key, u.label]))
  return { accountEmail: id => emails.get(id) ?? null, tableLabel: key => labels.get(key) ?? `${key} (gelöscht)` }
}
