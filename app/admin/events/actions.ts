// app/admin/events/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString, normalizeEmail } from '../../lib/form'
import { canCreateEvents } from '../../lib/permissions'
import { copyUpload, deleteUpload } from '../../lib/uploads'
import { loadPlan } from '../../lib/floorplan/store'
import { parseLayout } from '../../lib/floorplan/schema'
import type { SaveResult } from '../../lib/floorplan/editor-state'
import { loadEventForUser } from '../../lib/events/store'
import { parseEventForm } from '../../lib/events/settings'
import { initialUnits, replaceEventLayout } from '../../lib/events/save-layout'

// Die Berechtigung prüft JEDE Aktion selbst (über loadEventForUser -> eventLevel), nie nur die Seite.
// owner: Besitzer*in oder Admin, moderator: per Freigabe - darf alles außer löschen und freigeben.

export type FormState = { errors: string[] } | null

const SLUG_TAKEN = 'Adresse: Diese Adresse ist schon vergeben.'

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * Neues Event aus einer Vorlage. Plan UND Hintergrundbild werden kopiert (Snapshot, Konzept
 * Abschnitt 2) - spätere Änderungen an der Vorlage verändern das Event nicht. Neue Events sind
 * immer Entwurf.
 */
export async function createEvent(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events/new')
  if (!canCreateEvents(user)) redirect('/admin/events')

  const parsed = parseEventForm(formData)
  const plan = await loadPlan(formString(formData, 'planId', 50), user)
  const errors = parsed.ok ? [] : [...parsed.errors]
  if (!plan) errors.push('Bitte wähle einen Raumplan.')
  if (!parsed.ok || !plan) return { errors }

  const record = await prisma.floorPlan.findUnique({ where: { id: plan.id }, select: { backgroundFile: true, backgroundType: true } })
  const backgroundFile = record?.backgroundFile ? await copyUpload(record.backgroundFile) : null

  let eventId: string
  try {
    const event = await prisma.event.create({
      data: {
        ...parsed.fields,
        status: 'DRAFT',
        layout: plan.layout,
        backgroundFile,
        backgroundType: backgroundFile ? record?.backgroundType : null,
        ownerId: user.id,
        sourcePlanId: plan.id,
        units: { createMany: { data: initialUnits(plan.layout) } }
      }
    })
    eventId = event.id
  } catch (error) {
    await deleteUpload(backgroundFile)
    if (isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  redirect(`/admin/events/${eventId}?created=1`)
}

/** Titel, Adresse, Zeiten, Status, Buchungszeitraum, Mindestbelegung. */
export async function updateEventSettings(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')

  const parsed = parseEventForm(formData, event.timezone)
  if (!parsed.ok) return { errors: parsed.errors }

  try {
    await prisma.event.update({
      where: { id: event.id },
      data: { ...parsed.fields, ...(parsed.status ? { status: parsed.status } : {}) }
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { errors: [SLUG_TAKEN] }
    throw error
  }
  redirect(`/admin/events/${event.id}?settings=1`)
}

/**
 * Speichert den Plan des Events aus dem Editor (an die Event-id gebunden). Wie bei Vorlagen mit
 * Versionsprüfung; zusätzlich lehnt der Server Änderungen an belegten Einheiten ab
 * (app/lib/events/save-layout.ts).
 */
export async function saveEventLayout(eventId: string, baseVersion: number, layout: unknown): Promise<SaveResult> {
  const user = await requireUser('/admin/events')
  const event = typeof eventId === 'string' ? await loadEventForUser(eventId, user) : null
  if (!event) return { ok: false, reason: 'forbidden' }

  const parsed = parseLayout(layout)
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  if (!Number.isInteger(baseVersion)) return { ok: false, reason: 'conflict' }

  return replaceEventLayout(event.id, baseVersion, parsed.layout)
}

/**
 * Übernimmt den aktuellen Stand der Vorlage erneut (Plan und Hintergrundbild) - z.B. wenn die
 * Vorlage nach dem Anlegen des Events noch überarbeitet wurde. Dieselben Prüfungen wie beim
 * Speichern im Editor. Nur für Konten, die die Vorlage selbst sehen dürfen.
 */
export async function resyncEventFromTemplate(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')
  const plan = event.sourcePlanId ? await loadPlan(event.sourcePlanId, user) : null
  if (!plan) return { errors: ['Die Vorlage gibt es nicht mehr oder du hast keinen Zugriff darauf.'] }

  const baseVersion = Number(formString(formData, 'layoutVersion', 12))
  const result = await replaceEventLayout(event.id, Number.isInteger(baseVersion) ? baseVersion : -1, plan.layout)
  if (!result.ok) {
    return {
      errors: result.reason === 'occupied'
        ? ['Nicht übernommen – die Vorlage passt nicht zur aktuellen Belegung:', ...result.errors]
        : ['Der Plan wurde inzwischen geändert. Bitte lade die Seite neu und versuche es noch einmal.']
    }
  }

  const record = await prisma.floorPlan.findUnique({ where: { id: plan.id }, select: { backgroundFile: true, backgroundType: true } })
  const backgroundFile = record?.backgroundFile ? await copyUpload(record.backgroundFile) : null
  await prisma.event.update({
    where: { id: event.id },
    data: { backgroundFile, backgroundType: backgroundFile ? record?.backgroundType : null }
  })
  await deleteUpload(event.backgroundFile)
  redirect(`/admin/events/${event.id}?resynced=1`)
}

export async function removeEventBackground(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event) redirect('/admin/events')

  await prisma.event.update({ where: { id: event.id }, data: { backgroundFile: null, backgroundType: null } })
  await deleteUpload(event.backgroundFile)
  redirect(`/admin/events/${event.id}?background=removed`)
}

/**
 * Gibt das Event einem weiteren BESTEHENDEN Konto frei (wie sharePoll im Abstimmungstool). Nur
 * owner. Legt nie ein Konto an - wer noch keins hat, wird erst unter /admin/users eingeladen.
 * "Nicht gefunden" verrät eingeloggten Besitzer*innen, ob eine Adresse ein Konto hat - das ist
 * beabsichtigt, sonst wäre Teilen kaum bedienbar.
 */
export async function shareEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || event.level !== 'owner') redirect('/admin/events')

  const email = normalizeEmail(formString(formData, 'email', 254))
  const target = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null
  if (!target) redirect(`/admin/events/${event.id}?shareError=notfound`)
  if (target.id === event.ownerId) redirect(`/admin/events/${event.id}?shareError=owner`)

  await prisma.eventAccess.upsert({
    where: { eventId_userId: { eventId: event.id, userId: target.id } },
    update: {},
    create: { eventId: event.id, userId: target.id }
  })
  redirect(`/admin/events/${event.id}?shared=1`)
}

/** Nimmt eine Freigabe zurück. Nur owner des betroffenen Events. */
export async function unshareEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const access = await prisma.eventAccess.findUnique({ where: { id: formString(formData, 'accessId', 50) }, select: { id: true, eventId: true } })
  if (!access) redirect('/admin/events')
  const event = await loadEventForUser(access.eventId, user)
  if (!event || event.level !== 'owner') redirect('/admin/events')

  await prisma.eventAccess.delete({ where: { id: access.id } })
  redirect(`/admin/events/${event.id}?unshared=1`)
}

/**
 * Löscht das Event samt Einheiten, Buchungen, Belegungen und Freigaben (Cascade) und das
 * Hintergrundbild. Nur owner. Buchende werden (noch) nicht benachrichtigt - das kommt mit der
 * Buchungsverwaltung (Phase 4); die Seite warnt deshalb ausdrücklich vor aktiven Buchungen.
 */
export async function deleteEvent(formData: FormData) {
  const user = await requireUser('/admin/events')
  const event = await loadEventForUser(formString(formData, 'eventId', 50), user)
  if (!event || event.level !== 'owner') redirect('/admin/events')

  await prisma.event.delete({ where: { id: event.id } })
  await deleteUpload(event.backgroundFile)
  redirect('/admin/events?deleted=1')
}
