// app/admin/events/[id]/plan/page.tsx
import Link from 'next/link'
import { requireUser } from '../../../../lib/auth'
import { loadEventOr404 } from '../../../../lib/events/store'
import { saveEventLayout } from '../../actions'
import PlanEditor from '../../../../ui/plan/editor/plan-editor'
import Notice from '../../../../ui/notice'

export const dynamic = 'force-dynamic'

/** Editor für den Plan eines Events (eigene Kopie, unabhängig von der Vorlage). */
export default async function EventPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser(`/admin/events/${id}/plan`)
  const event = await loadEventOr404(id, user)
  const backgroundUrl = event.backgroundFile ? `/admin/events/${event.id}/background?v=${event.backgroundFile.slice(0, 8)}` : null

  return (
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-6xl mx-auto space-y-4 text-gray-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold">Plan: {event.title}</h1>
          <Link href={`/admin/events/${event.id}`} className="text-sm text-blue-700 hover:underline">Zurück zum Event</Link>
        </div>
        <Notice tone="info">
          Du bearbeitest den Plan dieses Events, nicht die Vorlage. Belegte Tische und Plätze lassen sich umbenennen und
          verschieben, aber nicht löschen, verkleinern oder auf „nicht buchbar“ setzen.
        </Notice>
        <PlanEditor
          name={event.title} initialLayout={event.layout} initialVersion={event.layoutVersion}
          backgroundUrl={backgroundUrl} save={saveEventLayout.bind(null, event.id)}
        />
      </div>
    </main>
  )
}
