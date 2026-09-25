// app/admin/plans/[id]/background/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { getCurrentUser } from '../../../../lib/auth'
import { baseUrl } from '../../../../lib/base-url'
import { loadPlan } from '../../../../lib/floorplan/store'
import { ALLOWED_IMAGE_MIMES, MAX_BACKGROUND_BYTES, detectImageType } from '../../../../lib/image-type'
import { deleteUpload, readUpload, saveUpload } from '../../../../lib/uploads'

/**
 * Hintergrundbild eines Raumplans.
 *
 * Bewusst ein Route Handler statt einer Server Action: Server Actions sind auf 1 MB begrenzt,
 * und dieses Limit für ALLE Actions anzuheben (auch die späteren öffentlichen Buchungsformulare)
 * wäre unnötig. Dafür prüft dieser Handler selbst, was Server Actions sonst automatisch tun:
 * Origin (CSRF) und Anmeldung - und wie überall die Berechtigung für genau diesen Plan.
 */

/** Spielraum für multipart-Rahmen (Boundary, Part-Header) über der Dateigröße. */
const MULTIPART_OVERHEAD = 64 * 1024

function back(planId: string, query: string) {
  const response = NextResponse.redirect(new URL(`/admin/plans/${planId}?${query}`, baseUrl()), 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/** Liefert das Bild aus - nur an Konten, die den Plan sehen dürfen. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })
  const plan = await loadPlan((await params).id, user)
  if (!plan) return new NextResponse('Nicht gefunden', { status: 404 })

  const record = await prisma.floorPlan.findUnique({ where: { id: plan.id }, select: { backgroundFile: true, backgroundType: true } })
  const data = record?.backgroundFile ? await readUpload(record.backgroundFile) : null
  if (!data || !record?.backgroundType || !ALLOWED_IMAGE_MIMES.has(record.backgroundType)) {
    return new NextResponse('Nicht gefunden', { status: 404 })
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      // Typ aus der Erkennung beim Upload, nie aus Dateiname oder Client-Angabe.
      'Content-Type': record.backgroundType,
      'X-Content-Type-Options': 'nosniff',
      // Selbst wenn ein Browser die Datei doch als Dokument öffnet: keine Skripte, keine Einbettung.
      // Maßgeblich ist die gleichlautende Regel in next.config.ts (Header von dort gewinnen).
      'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store'
    }
  })
}

/** Upload (normales HTML-Formular, multipart). Ersetzt ein vorhandenes Bild. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // CSRF: nur Formulare dieser App. Moderne Browser schicken Origin bei jedem POST mit.
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(baseUrl()).origin) return new NextResponse('Ungültige Herkunft', { status: 403 })

  const user = await getCurrentUser()
  if (!user) return new NextResponse('Nicht angemeldet', { status: 401 })
  const plan = await loadPlan((await params).id, user)
  if (!plan || plan.access !== 'edit') return new NextResponse('Nicht gefunden', { status: 404 })

  // Größe VOR dem Einlesen prüfen, damit niemand beliebig große Körper in den Speicher schiebt.
  const length = Number(request.headers.get('content-length'))
  if (!Number.isFinite(length) || length <= 0) return new NextResponse('Länge erforderlich', { status: 411 })
  if (length > MAX_BACKGROUND_BYTES + MULTIPART_OVERHEAD) return back(plan.id, 'background=size')

  let file: FormDataEntryValue | null
  try {
    file = (await request.formData()).get('file')
  } catch {
    return back(plan.id, 'background=invalid')
  }
  if (!(file instanceof File) || file.size === 0) return back(plan.id, 'background=missing')
  if (file.size > MAX_BACKGROUND_BYTES) return back(plan.id, 'background=size')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = detectImageType(bytes)
  if (!type) return back(plan.id, 'background=type')

  const name = await saveUpload(bytes, type.extension)
  const previous = await prisma.floorPlan.findUnique({ where: { id: plan.id }, select: { backgroundFile: true } })
  await prisma.floorPlan.update({ where: { id: plan.id }, data: { backgroundFile: name, backgroundType: type.mime } })
  await deleteUpload(previous?.backgroundFile)

  return back(plan.id, 'background=uploaded')
}
