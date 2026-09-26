// app/ui/background-card.tsx
import { MAX_BACKGROUND_BYTES } from '../lib/image-type'
import Notice from './notice'

const MESSAGES: Record<string, string> = {
  uploaded: 'Hintergrundbild gespeichert.',
  removed: 'Hintergrundbild entfernt.',
  type: 'Nur PNG, JPEG oder WebP sind erlaubt (erkannt am Dateiinhalt, nicht an der Endung).',
  size: `Das Bild ist zu groß (höchstens ${MAX_BACKGROUND_BYTES / 1024 / 1024} MB).`,
  missing: 'Bitte wähle eine Bilddatei aus.',
  invalid: 'Der Upload konnte nicht gelesen werden.'
}

/** Rückmeldung nach Upload/Entfernen (Query ?background=..., siehe app/lib/background.ts). */
export function BackgroundNotice({ outcome }: { outcome?: string }) {
  if (!outcome || !MESSAGES[outcome]) return null
  return <Notice tone={outcome === 'uploaded' || outcome === 'removed' ? 'success' : 'error'}>{MESSAGES[outcome]}</Notice>
}

/**
 * Upload/Entfernen eines Hintergrundbilds (Vorlagen und Events). Der Upload geht als normales
 * Formular an einen Route Handler (kein Server-Action-Limit von 1 MB), das Entfernen über eine
 * Server Action mit verstecktem id-Feld.
 */
export default function BackgroundCard({ uploadUrl, hasBackground, removeAction, idField, id }: {
  uploadUrl: string
  hasBackground: boolean
  removeAction: (formData: FormData) => Promise<void>
  idField: string
  id: string
}) {
  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      <h2 className="font-bold">Hintergrundbild</h2>
      <p className="text-xs text-gray-600">
        Ein Grundriss als Unterlage (PNG, JPEG oder WebP, höchstens {MAX_BACKGROUND_BYTES / 1024 / 1024} MB). Lage, Breite
        und Deckkraft stellst du im Editor ein, wenn nichts ausgewählt ist. Speichere vorher Änderungen im Editor –
        der Upload lädt die Seite neu.
      </p>
      <form action={uploadUrl} method="post" encType="multipart/form-data" className="space-y-2">
        <label htmlFor="background-file" className="block text-sm font-medium">Bilddatei</label>
        <input id="background-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required className="w-full text-sm" />
        <button type="submit" className="bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700">
          {hasBackground ? 'Bild ersetzen' : 'Bild hochladen'}
        </button>
      </form>
      {hasBackground && (
        <form action={removeAction}>
          <input type="hidden" name={idField} value={id} />
          <button type="submit" className="text-sm text-red-700 hover:underline">Hintergrundbild entfernen</button>
        </form>
      )}
    </div>
  )
}
