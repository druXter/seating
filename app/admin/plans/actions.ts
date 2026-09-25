// app/admin/plans/actions.ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { formString } from '../../lib/form'
import { canCreatePlans } from '../../lib/permissions'
import { copyUpload, deleteUpload } from '../../lib/uploads'
import { loadPlan } from '../../lib/floorplan/store'
import { LIMITS, emptyLayout, parseExport, parseLayout } from '../../lib/floorplan/schema'

// Die Berechtigung prüft JEDE Aktion selbst (über loadPlan -> planAccess), nie nur die Seite.

/** Import-Dateien: knapp unter dem Server-Action-Limit von 1 MB (inkl. multipart-Overhead). */
const IMPORT_MAX_BYTES = 900 * 1024

export type FormState = { errors: string[] } | null

function roomSize(formData: FormData, name: string): number | null {
  const meters = Number(formString(formData, name, 10).replace(',', '.'))
  const cm = Math.round(meters * 100)
  return Number.isFinite(meters) && cm >= LIMITS.minRoomSize && cm <= LIMITS.maxRoomSize ? cm : null
}

/** Neuer, leerer Plan. Für useActionState: gibt Fehler zurück oder leitet zum Editor weiter. */
export async function createPlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/plans/new')
  if (!canCreatePlans(user)) redirect('/admin')

  const name = formString(formData, 'name', LIMITS.maxLabelLength)
  const width = roomSize(formData, 'width')
  const height = roomSize(formData, 'height')
  const errors: string[] = []
  if (!name) errors.push('Bitte gib dem Raumplan einen Namen.')
  if (width === null || height === null) {
    errors.push(`Breite und Länge müssen zwischen ${LIMITS.minRoomSize / 100} und ${LIMITS.maxRoomSize / 100} m liegen.`)
  }
  if (errors.length > 0 || width === null || height === null) return { errors }

  const plan = await prisma.floorPlan.create({ data: { name, ownerId: user.id, layout: emptyLayout(width, height) } })
  redirect(`/admin/plans/${plan.id}`)
}

/**
 * Legt aus einer Export-Datei einen NEUEN Plan an - ein Import überschreibt nie einen
 * bestehenden. Die Datei durchläuft dieselbe Prüfung wie jedes Speichern; ein Hintergrundbild
 * gehört nie dazu.
 */
export async function importPlan(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/admin/plans/new')
  if (!canCreatePlans(user)) redirect('/admin')

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { errors: ['Bitte wähle eine Datei aus.'] }
  if (file.size > IMPORT_MAX_BYTES) return { errors: ['Die Datei ist zu groß (höchstens 900 KB).'] }

  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    return { errors: ['Die Datei enthält kein gültiges JSON.'] }
  }
  const parsed = parseExport(json)
  if (!parsed.ok) return { errors: parsed.errors }

  const fallbackName = file.name.replace(/\.json$/i, '').slice(0, LIMITS.maxLabelLength).trim()
  const name = formString(formData, 'name', LIMITS.maxLabelLength) || parsed.name || fallbackName || 'Importierter Raumplan'
  const plan = await prisma.floorPlan.create({ data: { name, ownerId: user.id, layout: parsed.layout } })
  redirect(`/admin/plans/${plan.id}?imported=1`)
}

/** Kopie eines eigenen oder als Vorlage angebotenen Plans - gehört danach dem kopierenden Konto. */
export async function duplicatePlan(formData: FormData) {
  const user = await requireUser('/admin/plans')
  if (!canCreatePlans(user)) redirect('/admin')

  const source = await loadPlan(formString(formData, 'planId', 50), user)
  if (!source) redirect('/admin/plans')

  const record = await prisma.floorPlan.findUnique({ where: { id: source.id }, select: { backgroundFile: true, backgroundType: true } })
  const backgroundFile = record?.backgroundFile ? await copyUpload(record.backgroundFile) : null
  const copy = await prisma.floorPlan.create({
    data: {
      name: `Kopie von ${source.name}`.slice(0, LIMITS.maxLabelLength),
      ownerId: user.id,
      layout: source.layout,
      backgroundFile,
      backgroundType: backgroundFile ? record?.backgroundType : null
    }
  })
  redirect(`/admin/plans/${copy.id}`)
}

/** Löscht einen Plan samt Hintergrundbild. Laufende Events sind nicht betroffen (sie haben ab Phase 2 eine Kopie). */
export async function deletePlan(formData: FormData) {
  const user = await requireUser('/admin/plans')
  const plan = await loadPlan(formString(formData, 'planId', 50), user)
  if (!plan || plan.access !== 'edit') redirect('/admin/plans')

  const record = await prisma.floorPlan.delete({ where: { id: plan.id } })
  await deleteUpload(record.backgroundFile)
  revalidatePath('/admin/plans')
  redirect('/admin/plans?deleted=1')
}

/** Name und Freigabe als gemeinsame Vorlage. Ändert den Plan selbst nicht (keine neue Version). */
export async function updatePlanSettings(formData: FormData) {
  const user = await requireUser('/admin/plans')
  const plan = await loadPlan(formString(formData, 'planId', 50), user)
  if (!plan || plan.access !== 'edit') redirect('/admin/plans')

  const name = formString(formData, 'name', LIMITS.maxLabelLength)
  if (!name) redirect(`/admin/plans/${plan.id}?error=name`)

  await prisma.floorPlan.update({ where: { id: plan.id }, data: { name, shared: formData.get('shared') === 'on' } })
  revalidatePath(`/admin/plans/${plan.id}`)
  redirect(`/admin/plans/${plan.id}?settings=1`)
}

/** Entfernt das Hintergrundbild (Datei und Verweis). Die Lage in layout.background bleibt harmlos stehen. */
export async function removeBackground(formData: FormData) {
  const user = await requireUser('/admin/plans')
  const plan = await loadPlan(formString(formData, 'planId', 50), user)
  if (!plan || plan.access !== 'edit') redirect('/admin/plans')

  const record = await prisma.floorPlan.findUnique({ where: { id: plan.id }, select: { backgroundFile: true } })
  await prisma.floorPlan.update({ where: { id: plan.id }, data: { backgroundFile: null, backgroundType: null } })
  await deleteUpload(record?.backgroundFile)
  redirect(`/admin/plans/${plan.id}?background=removed`)
}

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict' | 'invalid' | 'forbidden'; errors?: string[] }

/**
 * Speichert den Plan aus dem Editor. `baseVersion` ist die Version, auf der der Editor
 * aufgebaut hat: Hat inzwischen jemand anderes gespeichert (zweiter Tab, anderes Konto), wird
 * NICHT überschrieben - das bedingte Update (id UND version) ist dabei die eigentliche Sicherung,
 * nicht eine vorherige Abfrage.
 */
export async function savePlanLayout(planId: string, baseVersion: number, layout: unknown): Promise<SaveResult> {
  const user = await requireUser('/admin/plans')
  const plan = typeof planId === 'string' ? await loadPlan(planId, user) : null
  if (!plan || plan.access !== 'edit') return { ok: false, reason: 'forbidden' }

  const parsed = parseLayout(layout)
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors }
  if (!Number.isInteger(baseVersion)) return { ok: false, reason: 'conflict' }

  const result = await prisma.floorPlan.updateMany({
    where: { id: plan.id, version: baseVersion },
    data: { layout: parsed.layout, version: { increment: 1 } }
  })
  if (result.count === 0) return { ok: false, reason: 'conflict' }
  return { ok: true, version: baseVersion + 1 }
}
