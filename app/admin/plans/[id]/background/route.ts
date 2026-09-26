import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { loadPlan } from '../../../../lib/floorplan/store'
import { backTo, imageResponse, isSameOrigin, receiveImage } from '../../../../lib/background'
import { deleteUpload } from '../../../../lib/uploads'

/**
 * Hintergrundbild eines Raumplans. Ein Route Handler prüft selbst, was Server Actions sonst
 * automatisch tun: Origin (CSRF) und Anmeldung - und wie überall die Berechtigung für genau diesen
 * Plan. Upload und Auslieferung: app/lib/background.ts.
 */

/** Liefert das Bild aus - nur an Konten, die den Plan sehen dürfen. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })
  const plan = await loadPlan((await params).id, user)
  if (!plan) return new NextResponse('Nicht gefunden', { status: 404 })

  return imageResponse(await prisma.floorPlan.findUnique({ where: { id: plan.id }, select: { backgroundFile: true, backgroundType: true } }))
}

/** Upload (normales HTML-Formular, multipart). Ersetzt ein vorhandenes Bild. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse('Ungültige Herkunft', { status: 403 })

  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })
  const plan = await loadPlan((await params).id, user)
  if (!plan || plan.access !== 'edit') return new NextResponse('Nicht gefunden', { status: 404 })

  const back = `/admin/plans/${plan.id}`
  const received = await receiveImage(request)
  if (received === null) return new NextResponse('Länge erforderlich', { status: 411 })
  if (typeof received === 'string') return backTo(back, received)

  const previous = await prisma.floorPlan.findUnique({ where: { id: plan.id }, select: { backgroundFile: true } })
  await prisma.floorPlan.update({ where: { id: plan.id }, data: { backgroundFile: received.file, backgroundType: received.mime } })
  await deleteUpload(previous?.backgroundFile)

  return backTo(back, 'uploaded')
}
