// app/admin/plans/[id]/page.tsx
import { requireUser } from '../../../lib/auth'
import { loadPlanOr404 } from '../../../lib/floorplan/store'
import { summarize } from '../../../lib/floorplan/units'
import { duplicatePlan, removeBackground, savePlanLayout, updatePlanSettings } from '../actions'
import PlanSvg from '../../../ui/plan/plan-svg'
import PlanEditor from '../../../ui/plan/editor/plan-editor'
import { Badge, buttonClass, Card, inputClass, labelClass, Main, PageHeader, SettingsSection, Notice } from '../../../ui/kit'
import BackgroundCard, { BackgroundNotice } from '../../../ui/background-card'

export const dynamic = 'force-dynamic'

export default async function PlanPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ imported?: string; settings?: string; error?: string; background?: string }>
}) {
  const { id } = await params
  const user = await requireUser(`/admin/plans/${id}`)
  const plan = await loadPlanOr404(id, user)
  const { imported, settings, error, background } = await searchParams
  const summary = summarize(plan.layout)
  const backgroundUrl = plan.hasBackground ? `/admin/plans/${plan.id}/background?v=${plan.version}` : null

  return (
    <Main width="full">
      <PageHeader
        back={{ href: '/admin/plans', label: 'Alle Raumpläne' }}
        title={plan.name}
        subtitle={<>
          {plan.layout.width / 100} × {plan.layout.height / 100} m · {summary.tables} Tische · {summary.seats} Plätze
          {plan.shared && <> · <Badge tone="teal">gemeinsame Vorlage</Badge></>}
        </>}
        actions={<>
          <form action={duplicatePlan}>
            <input type="hidden" name="planId" value={plan.id} />
            <button type="submit" className={buttonClass('secondary', 'sm')}>Plan duplizieren</button>
          </form>
          <a href={`/admin/plans/${plan.id}/export`} className={buttonClass('secondary', 'sm')}>Als Datei exportieren</a>
        </>}
      />
      <div className="space-y-4">
        {imported === '1' && <Notice tone="success">Raumplan importiert.</Notice>}
        {settings === '1' && <Notice tone="success">Einstellungen gespeichert.</Notice>}
        {error === 'name' && <Notice tone="error">Der Name darf nicht leer sein.</Notice>}
        <BackgroundNotice outcome={background} />

        {plan.access === 'view' && (
          <Notice tone="info">
            Gemeinsame Vorlage von {plan.ownerEmail ?? 'einem gelöschten Konto'} – du kannst sie ansehen und für dich duplizieren.
          </Notice>
        )}

        {plan.access === 'edit' ? (
          <PlanEditor
            name={plan.name} initialLayout={plan.layout} initialVersion={plan.version}
            backgroundUrl={backgroundUrl} save={savePlanLayout.bind(null, plan.id)}
          />
        ) : (
          <Card padded={false} className="overflow-hidden">
            <PlanSvg layout={plan.layout} backgroundUrl={backgroundUrl} title={`Raumplan ${plan.name}`} className="block w-full h-auto max-h-[75vh]" />
          </Card>
        )}

        {plan.access === 'edit' && (
          <div className="grid gap-3 md:grid-cols-2 md:items-start">
            <SettingsSection id="settings" title="Name und Freigabe" summary={plan.shared ? 'gemeinsame Vorlage' : 'privat'} open={settings !== undefined || error !== undefined}>
              <form action={updatePlanSettings} className="space-y-3">
                <input type="hidden" name="planId" value={plan.id} />
                <div>
                  <label htmlFor="plan-name" className={labelClass}>Name</label>
                  <input id="plan-name" name="name" defaultValue={plan.name} required maxLength={100} className={inputClass} />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="shared" defaultChecked={plan.shared} className="mt-1" />
                  <span>
                    Als gemeinsame Vorlage anbieten
                    <span className="block text-xs text-gray-600 dark:text-gray-400">Andere Konten (außer Moderator*innen) können den Plan ansehen und duplizieren, aber nicht ändern.</span>
                  </span>
                </label>
                <button type="submit" className={buttonClass('primary')}>Einstellungen speichern</button>
              </form>
            </SettingsSection>
            <BackgroundCard
              uploadUrl={`/admin/plans/${plan.id}/background`} hasBackground={plan.hasBackground}
              removeAction={removeBackground} idField="planId" id={plan.id} open={background !== undefined}
            />
          </div>
        )}
      </div>
    </Main>
  )
}
