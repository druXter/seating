import { NextResponse } from 'next/server'
import { getCurrentUser } from '../../lib/auth'
import { isPubliclyVisible, loadEventBySlug, loadEventForUser } from '../../lib/events/store'
import { imageResponse } from '../../lib/background'

/**
 * Hintergrundbild für die öffentliche Eventseite - nur solange das Event öffentlich sichtbar ist
 * (sonst nur für Konten mit Zugriff, Vorschau). Header: Regel "/:slug/background" in next.config.ts.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const event = await loadEventBySlug((await params).slug)
  if (!event) return new NextResponse('Nicht gefunden', { status: 404 })
  if (!isPubliclyVisible(event.status)) {
    const user = await getCurrentUser()
    if (!user || !(await loadEventForUser(event.id, user))) return new NextResponse('Nicht gefunden', { status: 404 })
  }
  return imageResponse(event)
}
