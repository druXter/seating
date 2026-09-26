import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { loadEventForUser } from '../../../../lib/events/store'
import { backTo, imageResponse, isSameOrigin, receiveImage } from '../../../../lib/background'
import { deleteUpload } from '../../../../lib/uploads'

/**
 * Hintergrundbild des Event-Plans (eine eigene Kopie, unabhängig von der Vorlage). Gleiche Regeln
 * wie bei Vorlagen (app/admin/plans/[id]/background): Origin, Anmeldung, Berechtigung für genau
 * dieses Event. Öffentlich ausgeliefert wird es über app/[slug]/background.
 */

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })
  const event = await loadEventForUser((await params).id, user)
  if (!event) return new NextResponse('Nicht gefunden', { status: 404 })
  return imageResponse(event)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse('Ungültige Herkunft', { status: 403 })

  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })
  const event = await loadEventForUser((await params).id, user)
  if (!event) return new NextResponse('Nicht gefunden', { status: 404 })

  const back = `/admin/events/${event.id}`
  const received = await receiveImage(request)
  if (received === null) return new NextResponse('Länge erforderlich', { status: 411 })
  if (typeof received === 'string') return backTo(back, received)

  await prisma.event.update({ where: { id: event.id }, data: { backgroundFile: received.file, backgroundType: received.mime } })
  await deleteUpload(event.backgroundFile)
  return backTo(back, 'uploaded')
}
