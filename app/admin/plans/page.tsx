// app/admin/plans/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { canCreatePlans, planAccess } from '../../lib/permissions'
import { parseLayout } from '../../lib/floorplan/schema'
import { summarize } from '../../lib/floorplan/units'
import { deletePlan, duplicatePlan } from './actions'
import Notice from '../../ui/notice'
import ConfirmForm from '../../ui/confirm-form'

export const dynamic = 'force-dynamic'

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const user = await requireUser('/admin/plans')
  if (!canCreatePlans(user)) redirect('/admin')
  const { deleted } = await searchParams

  // Admins sehen alle Pläne, alle anderen die eigenen und die als Vorlage angebotenen.
  const plans = await prisma.floorPlan.findMany({
    where: user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, { shared: true }] },
    orderBy: { updatedAt: 'desc' },
    include: { owner: { select: { email: true } } }
  })

  const rows = plans.map(plan => {
    const parsed = parseLayout(plan.layout)
    return {
      ...plan,
      access: planAccess(user, plan),
      summary: parsed.ok ? summarize(parsed.layout) : null,
      size: parsed.ok ? `${parsed.layout.width / 100} × ${parsed.layout.height / 100} m` : '–'
    }
  })

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">Raumpläne</h1>
            <Link href="/admin/plans/new" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">
              Neuer Raumplan
            </Link>
          </div>
          <p className="text-sm text-gray-600">
            Raumpläne sind Vorlagen. Beim Anlegen eines Events wird der Plan kopiert – spätere Änderungen hier
            verändern keine laufenden Events.
          </p>
          {deleted === '1' && <Notice tone="success">Raumplan gelöscht.</Notice>}

          {rows.length === 0 ? (
            <p className="text-sm text-gray-600">Noch keine Raumpläne vorhanden.</p>
          ) : (
            <ul className="divide-y text-sm">
              {rows.map(plan => (
                <li key={plan.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="grow min-w-0">
                    <Link href={`/admin/plans/${plan.id}`} className="font-medium text-blue-700 hover:underline">{plan.name}</Link>
                    {plan.shared && <span className="ml-2 text-xs bg-green-100 text-green-800 rounded px-1.5 py-0.5">gemeinsame Vorlage</span>}
                    <div className="text-xs text-gray-600">
                      {plan.size}
                      {plan.summary && ` · ${plan.summary.tables} Tische · ${plan.summary.seats} Plätze`}
                      {plan.ownerId !== user.id && ` · von ${plan.owner?.email ?? 'gelöschtem Konto'}`}
                    </div>
                  </div>
                  <form action={duplicatePlan}>
                    <input type="hidden" name="planId" value={plan.id} />
                    <button type="submit" className="text-xs text-blue-700 hover:underline">Duplizieren</button>
                  </form>
                  {/* Bewusst <a>: Datei-Download über einen Route Handler, nicht vorab laden. */}
                  <a href={`/admin/plans/${plan.id}/export`} className="text-xs text-blue-700 hover:underline">Exportieren</a>
                  {plan.access === 'edit' && (
                    <ConfirmForm action={deletePlan} message={`Raumplan "${plan.name}" endgültig löschen?`}>
                      <input type="hidden" name="planId" value={plan.id} />
                      <button type="submit" className="text-xs text-red-700 hover:underline">Löschen</button>
                    </ConfirmForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
