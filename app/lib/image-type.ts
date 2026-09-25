// app/lib/image-type.ts

export type ImageType = { extension: 'png' | 'jpg' | 'webp'; mime: 'image/png' | 'image/jpeg' | 'image/webp' }

/** Größtes erlaubtes Hintergrundbild eines Raumplans. */
export const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024

export const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp'])

/**
 * Erkennt PNG, JPEG und WebP an den ersten Bytes ("Magic Numbers") - NICHT an Dateiname oder
 * dem vom Browser mitgeschickten Typ, beides bestimmt der Client. Alles andere wird abgelehnt,
 * ausdrücklich auch SVG: Es ist ein XML-Dokument und kann Skripte enthalten.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const starts = (signature: number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b)
  if (bytes.length >= 8 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { extension: 'png', mime: 'image/png' }
  if (bytes.length >= 3 && starts([0xff, 0xd8, 0xff])) return { extension: 'jpg', mime: 'image/jpeg' }
  // RIFF....WEBP
  if (bytes.length >= 12 && starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return { extension: 'webp', mime: 'image/webp' }
  return null
}
