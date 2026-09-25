// app/lib/uploads.ts
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Hochgeladene Dateien (bisher nur Hintergrundbilder von Raumplänen). Sie liegen außerhalb von
 * public/ - ausgeliefert werden sie nur über Route Handler mit Berechtigungsprüfung.
 *
 * Dateinamen erzeugt ausschließlich der Server (32 Hex-Zeichen + Endung). Jeder Name, der von
 * außen kommt oder aus der Datenbank gelesen wird, muss vor dem Dateizugriff FILE_NAME erfüllen -
 * so kann kein "../" o.Ä. je einen Pfad außerhalb des Upload-Verzeichnisses erreichen.
 *
 * Standard: data/uploads im Arbeitsverzeichnis - im Docker-Container /app/data/uploads, also im
 * gemounteten Volume neben der Datenbank.
 */
const FILE_NAME = /^[a-f0-9]{32}\.(png|jpg|webp)$/

export function uploadDir(): string {
  return resolve(process.env.UPLOAD_DIR || join(process.cwd(), 'data', 'uploads'))
}

function pathOf(name: string): string {
  if (!FILE_NAME.test(name)) throw new Error('Ungültiger Dateiname')
  return join(uploadDir(), name)
}

export async function saveUpload(data: Uint8Array, extension: 'png' | 'jpg' | 'webp'): Promise<string> {
  await mkdir(uploadDir(), { recursive: true })
  const name = `${randomBytes(16).toString('hex')}.${extension}`
  // wx: niemals eine bestehende Datei überschreiben.
  await writeFile(pathOf(name), data, { flag: 'wx' })
  return name
}

export async function readUpload(name: string): Promise<Buffer | null> {
  try {
    return await readFile(pathOf(name))
  } catch {
    return null
  }
}

/** Kopie unter neuem Namen (Plan duplizieren) - jeder Plan besitzt seine Datei allein. */
export async function copyUpload(name: string): Promise<string | null> {
  if (!FILE_NAME.test(name)) return null
  const extension = name.split('.')[1] as 'png' | 'jpg' | 'webp'
  const copy = `${randomBytes(16).toString('hex')}.${extension}`
  try {
    await copyFile(pathOf(name), pathOf(copy))
    return copy
  } catch {
    return null
  }
}

/** Löscht eine Datei; fehlt sie schon, ist das kein Fehler. */
export async function deleteUpload(name: string | null | undefined): Promise<void> {
  if (!name || !FILE_NAME.test(name)) return
  await unlink(pathOf(name)).catch(() => undefined)
}
