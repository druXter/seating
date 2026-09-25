// app/lib/floorplan/schema.ts
import { z } from 'zod'

/**
 * Datenformat eines Raumplans (docs/KONZEPT.md Abschnitt 2). Diese Prüfregeln gelten für
 * JEDEN Plan, der gespeichert oder importiert wird - der Editor im Browser nutzt dieselben,
 * maßgeblich ist aber immer die Prüfung auf dem Server.
 *
 * Einheiten: 1 = 1 cm. Positionen (x, y) sind der Mittelpunkt eines Elements, rotation in Grad
 * im Uhrzeigersinn. Jedes Element hat eine stabile, unveränderliche id (t12, s5, blk1, o3), aus
 * der die Schlüssel der buchbaren Einheiten abgeleitet werden (siehe units.ts). Buchungen
 * referenzieren später diese Schlüssel, nie die frei änderbaren Beschriftungen.
 *
 * Ändert sich das Format inkompatibel, steigt schemaVersion und parseLayout bekommt eine
 * Migration für ältere Dateien (Import aus anderen Instanzen).
 */

export const SCHEMA_VERSION = 1

export const LIMITS = {
  /** Größte Raumkante: 100 m. */
  maxRoomSize: 10_000,
  minRoomSize: 100,
  maxElements: 500,
  /** Buchbare Einheiten (Tische + Plätze) insgesamt. */
  maxUnits: 3000,
  maxLabelLength: 100,
  maxSeatsPerTable: 40,
  maxRows: 50,
  maxSeatsPerRow: 100
} as const

// Beschriftungen: getrimmt, ohne Steuerzeichen, begrenzt. React maskiert sie bei der Ausgabe.
const label = z
  .string()
  .max(LIMITS.maxLabelLength)
  .transform(value => value.replace(/[\u0000-\u001f\u007f]/g, '').trim())

// Positionen dürfen etwas über den Raum hinausragen (Objekte am Rand), aber nicht beliebig weit.
const coordinate = z.number().min(-1000).max(LIMITS.maxRoomSize + 1000)
const rotation = z.number().min(0).lt(360)
const size = (min: number, max: number) => z.number().min(min).max(max)

const base = {
  x: coordinate,
  y: coordinate,
  rotation,
  label: label.optional()
}

const tableSchema = z.strictObject({
  ...base,
  id: z.string().regex(/^t[1-9][0-9]{0,5}$/),
  type: z.literal('table'),
  shape: z.enum(['round', 'rect', 'oval']),
  /** Bei runden Tischen der Durchmesser (height wird ignoriert). */
  width: size(40, 2000),
  height: size(40, 2000),
  seats: z.int().min(0).max(LIMITS.maxSeatsPerTable),
  /** Nur bei rechteckigen Tischen: an welchen Seiten Plätze stehen (z.B. Tafel an der Wand). */
  sides: z.strictObject({ top: z.boolean(), right: z.boolean(), bottom: z.boolean(), left: z.boolean() }),
  bookable: z.boolean()
})

const seatSchema = z.strictObject({
  ...base,
  id: z.string().regex(/^s[1-9][0-9]{0,5}$/),
  type: z.literal('seat'),
  bookable: z.boolean()
})

const seatBlockSchema = z.strictObject({
  ...base,
  id: z.string().regex(/^blk[1-9][0-9]{0,5}$/),
  type: z.literal('seatBlock'),
  rows: z.int().min(1).max(LIMITS.maxRows),
  seatsPerRow: z.int().min(1).max(LIMITS.maxSeatsPerRow),
  seatSpacing: size(30, 300),
  rowSpacing: size(40, 400),
  /** Reihenbeschriftung: A, B, C ... oder 1, 2, 3 ... beginnend bei rowStart (1 = A bzw. 1). */
  rowLabels: z.enum(['letters', 'numbers']),
  rowStart: z.int().min(1).max(200),
  /** Platznummern von links nach rechts (ltr) oder umgekehrt, beginnend bei seatStart. */
  numbering: z.enum(['ltr', 'rtl']),
  seatStart: z.int().min(1).max(1000),
  /** Gänge: nach diesen Positionen (1-basiert, von links) bleibt eine Platzbreite frei. */
  aisles: z.array(z.int().min(1)).max(LIMITS.maxSeatsPerRow),
  /** Weggelassene Plätze als "reihe-platz" (Positionen, 1-basiert), z.B. "1-1" für vorne links. */
  omitted: z.array(z.string().regex(/^[1-9][0-9]{0,2}-[1-9][0-9]{0,2}$/)).max(LIMITS.maxRows * LIMITS.maxSeatsPerRow),
  /** 0 = gerade Reihen, sonst Radius der vordersten Reihe in cm (Bogen um einen Punkt vor dem Block). */
  curveRadius: z.number().min(0).max(100_000),
  bookable: z.boolean()
})

export const STATIC_KINDS = ['stage', 'danceFloor', 'bar', 'buffet', 'door', 'pillar', 'wall', 'text'] as const

const staticSchema = z.strictObject({
  ...base,
  id: z.string().regex(/^o[1-9][0-9]{0,5}$/),
  type: z.literal('static'),
  kind: z.enum(STATIC_KINDS),
  shape: z.enum(['rect', 'round']),
  width: size(5, LIMITS.maxRoomSize),
  height: size(5, LIMITS.maxRoomSize)
})

export const elementSchema = z.discriminatedUnion('type', [tableSchema, seatSchema, seatBlockSchema, staticSchema])

/**
 * Lage des Hintergrundbilds. Das Bild selbst liegt NICHT im Plan, sondern als Datei auf dem
 * Server (FloorPlan.backgroundFile) - so kann ein importierter Plan nie auf eine fremde Datei
 * zeigen, und der Export enthält keine Binärdaten.
 */
const backgroundSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: size(10, LIMITS.maxRoomSize * 2),
  opacity: z.number().min(0).max(1)
})

export const layoutSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    width: size(LIMITS.minRoomSize, LIMITS.maxRoomSize),
    height: size(LIMITS.minRoomSize, LIMITS.maxRoomSize),
    grid: z.int().min(1).max(500),
    /** Nächste freie Nummer für neue Element-ids. Läuft nur vorwärts - gelöschte ids kommen nie wieder. */
    nextId: z.int().min(1).max(999_999),
    background: backgroundSchema.optional(),
    elements: z.array(elementSchema).max(LIMITS.maxElements)
  })
  .superRefine((layout, ctx) => {
    const ids = new Set<string>()
    let units = 0
    layout.elements.forEach((element, index) => {
      const path = ['elements', index]
      if (ids.has(element.id)) ctx.addIssue({ code: 'custom', path: [...path, 'id'], message: `Doppelte id "${element.id}".` })
      ids.add(element.id)

      const number = Number(element.id.replace(/^[a-z]+/, ''))
      if (number >= layout.nextId) {
        ctx.addIssue({ code: 'custom', path: ['nextId'], message: `nextId muss größer sein als die Nummer von "${element.id}".` })
      }

      if (element.type === 'table') {
        units += 1 + element.seats
        if (element.shape === 'rect' && element.seats > 0 && !Object.values(element.sides).some(Boolean)) {
          ctx.addIssue({ code: 'custom', path: [...path, 'sides'], message: 'Mindestens eine Tischseite braucht Plätze.' })
        }
      } else if (element.type === 'seat') {
        units += 1
      } else if (element.type === 'seatBlock') {
        units += element.rows * element.seatsPerRow - element.omitted.length
        if (element.aisles.some(a => a >= element.seatsPerRow)) {
          ctx.addIssue({ code: 'custom', path: [...path, 'aisles'], message: 'Ein Gang muss zwischen zwei Plätzen liegen.' })
        }
        if (new Set(element.aisles).size !== element.aisles.length) {
          ctx.addIssue({ code: 'custom', path: [...path, 'aisles'], message: 'Gänge doppelt angegeben.' })
        }
        if (new Set(element.omitted).size !== element.omitted.length) {
          ctx.addIssue({ code: 'custom', path: [...path, 'omitted'], message: 'Weggelassene Plätze doppelt angegeben.' })
        }
        for (const position of element.omitted) {
          const [row, seat] = position.split('-').map(Number)
          if (row > element.rows || seat > element.seatsPerRow) {
            ctx.addIssue({ code: 'custom', path: [...path, 'omitted'], message: `Platz "${position}" liegt außerhalb des Blocks.` })
          }
        }
      }
    })
    if (units > LIMITS.maxUnits) {
      ctx.addIssue({ code: 'custom', path: ['elements'], message: `Zu viele Plätze (${units}, höchstens ${LIMITS.maxUnits}).` })
    }
  })

export type Layout = z.infer<typeof layoutSchema>
export type LayoutElement = z.infer<typeof elementSchema>
export type TableElement = z.infer<typeof tableSchema>
export type SeatElement = z.infer<typeof seatSchema>
export type SeatBlockElement = z.infer<typeof seatBlockSchema>
export type StaticElement = z.infer<typeof staticSchema>
export type StaticKind = (typeof STATIC_KINDS)[number]

export type ParseResult = { ok: true; layout: Layout } | { ok: false; errors: string[] }

/** Menschenlesbare Fehlerliste (höchstens 10 Einträge) für Import- und Speicher-Meldungen. */
function describe(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map(issue => {
    const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    return `${where}${issue.message}`
  })
}

/** Prüft einen Plan aus unbekannter Quelle (Import, Speichern aus dem Browser). */
export function parseLayout(input: unknown): ParseResult {
  const result = layoutSchema.safeParse(input)
  return result.success ? { ok: true, layout: result.data } : { ok: false, errors: describe(result.error) }
}

/** Format einer Export-Datei. `format` verhindert, dass beliebiges JSON als Raumplan durchgeht. */
export const EXPORT_FORMAT = 'seating-floorplan'

const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  name: z.string().max(LIMITS.maxLabelLength).optional(),
  layout: z.unknown()
})

export type ParsedExport = { ok: true; name: string | undefined; layout: Layout } | { ok: false; errors: string[] }

/** Liest eine Export-Datei (bereits als JSON geparst). Das Hintergrundbild gehört nie dazu. */
export function parseExport(input: unknown): ParsedExport {
  const wrapper = exportSchema.safeParse(input)
  if (!wrapper.success) return { ok: false, errors: ['Das ist keine Raumplan-Datei dieses Tools.'] }
  const layout = parseLayout(wrapper.data.layout)
  if (!layout.ok) return layout
  const { background: _ignored, ...rest } = layout.layout
  void _ignored
  return { ok: true, name: wrapper.data.name?.trim() || undefined, layout: rest }
}

/** Leerer Plan für einen neuen Raum. */
export function emptyLayout(width: number, height: number): Layout {
  return { schemaVersion: SCHEMA_VERSION, width, height, grid: 50, nextId: 1, elements: [] }
}
