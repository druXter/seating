// app/admin/events/[id]/plan/page.tsx
import { requireUser } from '../../../../lib/auth'
import { loadPlan } from '../../../../lib/floorplan/store'
import { loadEventOr404 } from '../../../../lib/events/store'
import { removeEventBackground, saveEventLayout } from '../../actions'
import { ResyncForm } from '../../event-forms'
import PlanEditor from '../../../../ui/plan/editor/plan-editor'
import BackgroundCard, { BackgroundNotice } from '../../../../ui/background-card'
import { SettingsSection, Notice } from '../../../../ui/kit'

export const dynamic = 'force-dynamic'

/**
 * Reiter „Raumplan“: Editor für den Plan des Events (eigene Kopie, unabhängig von der Vorlage), darunter Vorlage und
 * Hintergrundbild. Der Editor braucht Platz und eine Maus - auf dem Handy reicht er für kleine Korrekturen.
 */
export default async function EventPlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ resynced?: string; background?: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/plan`)
  const event = await loadEventOr404(id, user)
  const search = await searchParams
  const backgroundUrl = event.backgroundFile ? `/admin/events/${event.id}/background?v=${event.backgroundFile.slice(0, 8)}` : null
  const sourcePlan = event.sourcePlanId ? await loadPlan(event.sourcePlanId, user) : null

  return (
    <div className="space-y-4">
      {search.resynced === '1' && <Notice tone="success">Plan aus der Vorlage übernommen.</Notice>}
      <BackgroundNotice outcome={search.background} />
      <Notice tone="info">
        Du bearbeitest den Plan dieses Events, nicht die Vorlage. Belegte Tische und Plätze lassen sich umbenennen und
        verschieben, aber nicht löschen, verkleinern oder auf „nicht buchbar“ setzen.
      </Notice>
      <PlanEditor
        name={event.title} initialLayout={event.layout} initialVersion={event.layoutVersion}
        backgroundUrl={backgroundUrl} save={saveEventLayout.bind(null, event.id)}
      />
      <div className="grid gap-3 md:grid-cols-2 md:items-start">
        <SettingsSection id="template" title="Vorlage" summary={event.sourcePlanId ? (sourcePlan ? sourcePlan.name : 'nicht sichtbar') : 'gelöscht'} open={search.resynced !== undefined}>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Kopie der Vorlage {event.sourcePlanId ? (sourcePlan ? `„${sourcePlan.name}“` : '(für dich nicht sichtbar)') : '(inzwischen gelöscht)'}.
            Änderungen an der Vorlage wirken sich nicht auf dieses Event aus.
          </p>
          {sourcePlan && <ResyncForm eventId={event.id} layoutVersion={event.layoutVersion} planName={sourcePlan.name} />}
        </SettingsSection>
        <BackgroundCard
          uploadUrl={`/admin/events/${event.id}/background`} hasBackground={event.backgroundFile !== null}
          removeAction={removeEventBackground} idField="eventId" id={event.id} open={search.background !== undefined}
        />
      </div>
    </div>
  )
}
