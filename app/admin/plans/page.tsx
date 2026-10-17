// app/admin/plans/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '../../lib/prisma'
import { requireUser } from '../../lib/auth'
import { canCreatePlans, planAccess } from '../../lib/permissions'
import { parseLayout } from '../../lib/floorplan/schema'
import { summarize } from '../../lib/floorplan/units'
import { deletePlan, duplicatePlan } from './actions'
import { Badge, ButtonLink, buttonClass, EmptyState, Main, PageHeader, Notice, ConfirmForm } from '../../ui/kit'

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
    <Main>
      <PageHeader
        title="Raumpläne"
        subtitle="Raumpläne sind Vorlagen. Beim Anlegen eines Events wird der Plan kopiert – spätere Änderungen hier verändern keine laufenden Events."
        actions={<ButtonLink href="/admin/plans/new" variant="primary">Neuer Raumplan</ButtonLink>}
      />
      <div className="space-y-4">
        {deleted === '1' && <Notice tone="success">Raumplan gelöscht.</Notice>}
        {rows.length === 0 ? (
          <EmptyState>Noch keine Raumpläne. Lege oben den ersten an oder importiere eine Datei.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {rows.map(plan => (
              <li key={plan.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow sm:flex-row sm:items-center dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700">
                <Link href={`/admin/plans/${plan.id}`} className="group min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">{plan.name}</span>
                    {plan.shared && <Badge tone="teal">gemeinsame Vorlage</Badge>}
                  </span>
                  <span className="mt-0.5 block text-sm text-gray-500 dark:text-gray-400">
                    {plan.size}
                    {plan.summary && ` · ${plan.summary.tables} Tische · ${plan.summary.seats} Plätze`}
                    {plan.ownerId !== user.id && ` · von ${plan.owner?.email ?? 'gelöschtem Konto'}`}
                  </span>
                </Link>
                <div className="flex flex-wrap gap-2">
                  <form action={duplicatePlan}>
                    <input type="hidden" name="planId" value={plan.id} />
                    <button type="submit" className={buttonClass('secondary', 'sm')}>Duplizieren</button>
                  </form>
                  {/* Bewusst <a>: Datei-Download über einen Route Handler, nicht vorab laden. */}
                  <a href={`/admin/plans/${plan.id}/export`} className={buttonClass('secondary', 'sm')}>Exportieren</a>
                  {plan.access === 'edit' && (
                    <ConfirmForm action={deletePlan} message={`Raumplan "${plan.name}" endgültig löschen?`}>
                      <input type="hidden" name="planId" value={plan.id} />
                      <button type="submit" className={buttonClass('danger', 'sm')}>Löschen</button>
                    </ConfirmForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Main>
  )
}
