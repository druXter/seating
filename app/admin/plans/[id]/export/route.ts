// app/admin/plans/[id]/export/route.ts
import { NextResponse } from 'next/server'
import { getCurrentUser } from '../../../../lib/auth'
import { loadPlan } from '../../../../lib/floorplan/store'
import { EXPORT_FORMAT } from '../../../../lib/floorplan/schema'

/**
 * Download eines Plans als JSON (Format siehe parseExport). Nur lesend - GET verändert nichts.
 * Ohne Zugriff 404 statt 403, damit fremde Plan-ids nicht bestätigt werden. Das Hintergrundbild
 * gehört nicht dazu.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })

  const plan = await loadPlan((await params).id, user)
  if (!plan) return new NextResponse('Nicht gefunden', { status: 404 })

  const { background: _background, ...layout } = plan.layout
  void _background
  const body = JSON.stringify({ format: EXPORT_FORMAT, name: plan.name, layout }, null, 2)

  // Dateiname: ASCII-Fassung für alte Clients, UTF-8-Fassung (RFC 5987) für alle anderen.
  const ascii = plan.name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'raumplan'
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ascii}.json"; filename*=UTF-8''${encodeURIComponent(plan.name.slice(0, 60))}.json`,
      'Cache-Control': 'no-store'
    }
  })
}
