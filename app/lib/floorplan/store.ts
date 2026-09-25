// app/lib/floorplan/store.ts
import { notFound } from 'next/navigation'
import { prisma } from '../prisma'
import { planAccess, type PlanAccess } from '../permissions'
import type { CurrentUser } from '../auth'
import { parseLayout, type Layout } from './schema'

export type LoadedPlan = {
  id: string
  name: string
  ownerId: string | null
  ownerEmail: string | null
  shared: boolean
  version: number
  hasBackground: boolean
  layout: Layout
  updatedAt: Date
  access: PlanAccess
}

/**
 * Lädt einen Plan für ein Konto oder gibt null zurück, wenn es ihn nicht gibt ODER das Konto
 * keinen Zugriff hat - beides sieht nach außen gleich aus (niemand soll fremde Plan-ids
 * erraten und ihre Existenz bestätigt bekommen).
 *
 * Das gespeicherte JSON wird beim Lesen erneut geprüft: Es wurde zwar vor dem Schreiben
 * geprüft, aber ein von Hand oder durch ein älteres Programm geänderter Datensatz soll den
 * Editor nicht mit einem unerwarteten Format füttern.
 */
export async function loadPlan(id: string, user: CurrentUser): Promise<LoadedPlan | null> {
  const plan = await prisma.floorPlan.findUnique({ where: { id }, include: { owner: { select: { email: true } } } })
  if (!plan) return null
  const access = planAccess(user, plan)
  if (!access) return null

  const parsed = parseLayout(plan.layout)
  if (!parsed.ok) {
    console.error(`[floorplan] Gespeicherter Plan ${plan.id} ist ungültig:`, parsed.errors)
    return null
  }
  return {
    id: plan.id,
    name: plan.name,
    ownerId: plan.ownerId,
    ownerEmail: plan.owner?.email ?? null,
    shared: plan.shared,
    version: plan.version,
    hasBackground: plan.backgroundFile !== null,
    layout: parsed.layout,
    updatedAt: plan.updatedAt,
    access
  }
}

/** Wie loadPlan, aber für Seiten: fehlender Zugriff ergibt 404. */
export async function loadPlanOr404(id: string, user: CurrentUser): Promise<LoadedPlan> {
  const plan = await loadPlan(id, user)
  if (!plan) notFound()
  return plan
}
