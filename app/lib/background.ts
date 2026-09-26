// app/lib/background.ts
import { NextResponse } from 'next/server'
import { baseUrl } from './base-url'
import { ALLOWED_IMAGE_MIMES, MAX_BACKGROUND_BYTES, detectImageType } from './image-type'
import { readUpload, saveUpload } from './uploads'

/**
 * Hintergrundbilder von Vorlagen und Events: Upload und Auslieferung für die Route Handler
 * (app/admin/plans/[id]/background, app/admin/events/[id]/background, app/[slug]/background).
 * Anmeldung und Berechtigung prüft jeder Handler selbst VOR dem Aufruf.
 *
 * Bewusst Route Handler statt Server Actions: Server Actions sind auf 1 MB begrenzt, und dieses
 * Limit für ALLE Actions anzuheben (auch die öffentlichen Buchungsformulare) wäre unnötig.
 */

/** Spielraum für multipart-Rahmen (Boundary, Part-Header) über der Dateigröße. */
const MULTIPART_OVERHEAD = 64 * 1024

/** Rückmeldungen als Query-Wert ?background=... (Texte in app/ui/background-messages.ts). */
export type UploadOutcome = 'uploaded' | 'size' | 'invalid' | 'missing' | 'type'

/** CSRF-Schutz für normale Formulare: nur Absendungen von dieser App (moderne Browser schicken Origin bei jedem POST). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return origin !== null && origin === new URL(baseUrl()).origin
}

/** 303 zurück auf die Seite mit dem Formular. */
export function backTo(path: string, outcome: UploadOutcome | 'removed'): NextResponse {
  const response = NextResponse.redirect(new URL(`${path}?background=${outcome}`, baseUrl()), 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * Liest die Datei aus dem Formular, prüft Größe (VOR dem Einlesen) und Dateiart (am Inhalt, nie an
 * Namen oder Client-Angabe) und legt sie ab. Gibt den Dateinamen oder den Grund der Ablehnung zurück;
 * null bedeutet: keine Längenangabe (411).
 */
export async function receiveImage(request: Request): Promise<{ file: string; mime: string } | UploadOutcome | null> {
  const length = Number(request.headers.get('content-length'))
  if (!Number.isFinite(length) || length <= 0) return null
  if (length > MAX_BACKGROUND_BYTES + MULTIPART_OVERHEAD) return 'size'

  let file: FormDataEntryValue | null
  try {
    file = (await request.formData()).get('file')
  } catch {
    return 'invalid'
  }
  if (!(file instanceof File) || file.size === 0) return 'missing'
  if (file.size > MAX_BACKGROUND_BYTES) return 'size'

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = detectImageType(bytes)
  if (!type) return 'type'
  return { file: await saveUpload(bytes, type.extension), mime: type.mime }
}

/** Liefert ein gespeichertes Bild aus - oder 404, wenn Datei oder Typ fehlen. */
export async function imageResponse(record: { backgroundFile: string | null; backgroundType: string | null } | null): Promise<NextResponse> {
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
      // Maßgeblich sind die gleichlautenden Regeln in next.config.ts (Header von dort gewinnen).
      'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store'
    }
  })
}
