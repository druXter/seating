// app/lib/slugs.ts

/**
 * Öffentliche Eventseiten liegen direkt unter /<slug> (Phase 2). Jeder Pfad, den das Tool
 * selbst belegt, muss deshalb als Slug gesperrt sein - sonst könnte ein Event z.B. "admin"
 * heißen und mit dem Admin-Bereich kollidieren (und die Header-Regeln in next.config.ts
 * durcheinanderbringen). tests/unit/slugs.test.ts prüft, dass jedes Routen-Verzeichnis unter
 * app/ hier eingetragen ist.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Eigene Routen
  'admin', 'api', 'login', 'logout', 'account', 'forgot-password', 'reset-password',
  'impressum', 'datenschutz',
  // Laut Konzept vorgesehen (Verwaltungslink, Verifizierung, Raumpläne)
  'b', 'verify', 'plans',
  // Next.js und Web-Standards (enthalten zum Teil Zeichen, die das Slug-Format ohnehin
  // ausschließt - trotzdem hier, damit die Liste vollständig ist)
  '_next', '.well-known', 'favicon.ico', 'icon', 'apple-icon', 'manifest', 'robots.txt', 'sitemap.xml', 'sw.js',
  // Naheliegende Namen, die künftige Seiten brauchen könnten
  'static', 'public', 'assets', 'new', 'events', 'users', 'settings', 'help', 'hilfe', 'kontakt'
])

export const SLUG_MIN_LENGTH = 2
export const SLUG_MAX_LENGTH = 60

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Gibt eine Fehlermeldung zurück oder null, wenn der Slug verwendbar ist. Erlaubt sind
 * Kleinbuchstaben, Ziffern und einzelne Bindestriche zwischen ihnen.
 */
export function validateSlug(slug: string): string | null {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return `Die Adresse muss zwischen ${SLUG_MIN_LENGTH} und ${SLUG_MAX_LENGTH} Zeichen lang sein.`
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'Erlaubt sind nur Kleinbuchstaben, Ziffern und Bindestriche (nicht am Anfang oder Ende).'
  }
  if (RESERVED_SLUGS.has(slug)) return 'Diese Adresse ist für das Tool selbst reserviert.'
  return null
}
