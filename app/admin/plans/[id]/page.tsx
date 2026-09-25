// app/admin/plans/[id]/page.tsx
import Link from 'next/link'
import { requireUser } from '../../../lib/auth'
import { loadPlanOr404 } from '../../../lib/floorplan/store'
import { summarize } from '../../../lib/floorplan/units'
import { duplicatePlan, removeBackground, updatePlanSettings } from '../actions'
import { MAX_BACKGROUND_BYTES } from '../../../lib/image-type'
import PlanSvg from '../../../ui/plan/plan-svg'
import PlanEditor from './editor/plan-editor'
import Notice from '../../../ui/notice'

export const dynamic = 'force-dynamic'

const BACKGROUND_MESSAGES: Record<string, string> = {
  uploaded: 'Hintergrundbild gespeichert.',
  removed: 'Hintergrundbild entfernt.',
  type: 'Nur PNG, JPEG oder WebP sind erlaubt (erkannt am Dateiinhalt, nicht an der Endung).',
  size: `Das Bild ist zu groß (höchstens ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB).`,
  missing: 'Bitte wähle eine Bilddatei aus.',
  invalid: 'Der Upload konnte nicht gelesen werden.'
}

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
    <main className="bg-gray-50 py-6 px-4">
      <div className="max-w-6xl mx-auto space-y-4 text-gray-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold">{plan.name}</h1>
          <p className="text-sm text-gray-600">
            {plan.layout.width / 100} × {plan.layout.height / 100} m · {summary.tables} Tische · {summary.seats} Plätze
            {' · '}<Link href="/admin/plans" className="text-blue-700 hover:underline">Alle Raumpläne</Link>
          </p>
        </div>

        {imported === '1' && <Notice tone="success">Raumplan importiert.</Notice>}
        {settings === '1' && <Notice tone="success">Einstellungen gespeichert.</Notice>}
        {error === 'name' && <Notice tone="error">Der Name darf nicht leer sein.</Notice>}
        {background && BACKGROUND_MESSAGES[background] && (
          <Notice tone={background === 'uploaded' || background === 'removed' ? 'success' : 'error'}>{BACKGROUND_MESSAGES[background]}</Notice>
        )}

        {plan.access === 'view' && (
          <Notice tone="info">
            Gemeinsame Vorlage von {plan.ownerEmail ?? 'einem gelöschten Konto'} – du kannst sie ansehen und für dich duplizieren.
          </Notice>
        )}

        {plan.access === 'edit' ? (
          <PlanEditor
            planId={plan.id} planName={plan.name} initialLayout={plan.layout} initialVersion={plan.version}
            backgroundUrl={backgroundUrl}
          />
        ) : (
          <div className="bg-white rounded-lg shadow p-2">
            <PlanSvg layout={plan.layout} backgroundUrl={backgroundUrl} title={`Raumplan ${plan.name}`} className="w-full h-auto max-h-[75vh]" />
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {plan.access === 'edit' && (
            <form action={updatePlanSettings} className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Einstellungen</h2>
              <input type="hidden" name="planId" value={plan.id} />
              <div>
                <label htmlFor="plan-name" className="block text-sm font-medium mb-1">Name</label>
                <input id="plan-name" name="name" defaultValue={plan.name} required maxLength={100} className="w-full border border-gray-300 p-2 rounded" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="shared" defaultChecked={plan.shared} className="mt-1" />
                <span>
                  Als gemeinsame Vorlage anbieten
                  <span className="block text-xs text-gray-600">Andere Konten (außer Moderator*innen) können den Plan ansehen und duplizieren, aber nicht ändern.</span>
                </span>
              </label>
              <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">Einstellungen speichern</button>
            </form>
          )}
          {plan.access === 'edit' && (
            <div className="bg-white rounded-lg shadow p-4 space-y-3">
              <h2 className="font-bold">Hintergrundbild</h2>
              <p className="text-xs text-gray-600">
                Ein Grundriss als Unterlage (PNG, JPEG oder WebP, höchstens {MAX_BACKGROUND_BYTES / 1024 / 1024} MB). Lage, Breite
                und Deckkraft stellst du im Editor ein, wenn nichts ausgewählt ist. Speichere vorher Änderungen im Editor –
                der Upload lädt die Seite neu.
              </p>
              {/* Normales Formular an den Route Handler (kein Server-Action-Limit von 1 MB). */}
              <form action={`/admin/plans/${plan.id}/background`} method="post" encType="multipart/form-data" className="space-y-2">
                <label htmlFor="background-file" className="block text-sm font-medium">Bilddatei</label>
                <input id="background-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required className="w-full text-sm" />
                <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">
                  {plan.hasBackground ? 'Bild ersetzen' : 'Bild hochladen'}
                </button>
              </form>
              {plan.hasBackground && (
                <form action={removeBackground}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <button type="submit" className="text-sm text-red-700 hover:underline">Hintergrundbild entfernen</button>
                </form>
              )}
            </div>
          )}
          <div className="bg-white rounded-lg shadow p-4 space-y-2 text-sm">
            <h2 className="font-bold">Aktionen</h2>
            <form action={duplicatePlan}>
              <input type="hidden" name="planId" value={plan.id} />
              <button type="submit" className="text-blue-700 hover:underline">Plan duplizieren</button>
            </form>
            <a href={`/admin/plans/${plan.id}/export`} className="block text-blue-700 hover:underline">Als Datei exportieren</a>
          </div>
        </div>
      </div>
    </main>
  )
}
