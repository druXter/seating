// app/lib/floorplan/editor-state.ts
import { cloneElement, withElement, type NewElementKind } from './factory'
import { snap, type Point } from './geometry'
import { LIMITS, type Layout, type LayoutElement } from './schema'

/**
 * Zustand des Raumplan-Editors als reine Funktion (kein React, kein Browser) - damit sind
 * Rückgängig/Wiederholen, Duplizieren usw. per Unit-Test prüfbar.
 *
 * Verlauf: Jede Änderung legt den vorherigen Plan in `past`. Gesten (Ziehen, Drehen) bestehen aus
 * vielen Zwischenschritten - sie beginnen mit `beginGesture` (EIN Eintrag im Verlauf) und
 * schicken danach `transient`-Änderungen, die keinen weiteren Eintrag erzeugen.
 */

export const HISTORY_LIMIT = 100

export type EditorState = {
  layout: Layout
  selection: string[]
  past: Layout[]
  future: Layout[]
  /** Zuletzt gespeicherter Stand - ungleich `layout` heißt: ungespeicherte Änderungen. */
  saved: Layout
}

export type ElementPatch = Partial<Omit<LayoutElement, 'id' | 'type'>> & Record<string, unknown>

export type EditorAction =
  | { type: 'add'; kind: NewElementKind; at: Point }
  | { type: 'select'; ids: string[]; mode?: 'replace' | 'toggle' }
  | { type: 'selectAll' }
  | { type: 'beginGesture' }
  | { type: 'moveTo'; positions: Record<string, Point>; transient?: boolean }
  | { type: 'moveBy'; dx: number; dy: number }
  | { type: 'update'; id: string; patch: ElementPatch; transient?: boolean }
  | { type: 'updateLayout'; patch: Partial<Pick<Layout, 'width' | 'height' | 'grid' | 'background'>> }
  | { type: 'duplicate' }
  | { type: 'delete' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; layout: Layout }

export function initEditor(layout: Layout): EditorState {
  return { layout, selection: [], past: [], future: [], saved: layout }
}

export function isDirty(state: EditorState): boolean {
  return state.layout !== state.saved
}

const MIN_COORD = -1000

function clampCoord(value: number): number {
  return Math.min(LIMITS.maxRoomSize + 1000, Math.max(MIN_COORD, Math.round(value * 10) / 10))
}

export function normalizeRotation(value: number): number {
  const r = ((Math.round(value * 10) / 10) % 360 + 360) % 360
  return r >= 360 ? 0 : r
}

/** Neuer Plan mit Verlaufseintrag. */
function commit(state: EditorState, layout: Layout, selection = state.selection): EditorState {
  if (layout === state.layout) return { ...state, selection }
  const past = [...state.past, state.layout].slice(-HISTORY_LIMIT)
  return { ...state, layout, selection, past, future: [] }
}

/** Neuer Plan ohne Verlaufseintrag (Zwischenschritt einer Geste). */
function replace(state: EditorState, layout: Layout): EditorState {
  return { ...state, layout }
}

function mapElements(layout: Layout, ids: ReadonlySet<string>, fn: (element: LayoutElement) => LayoutElement): Layout {
  let changed = false
  const elements = layout.elements.map(element => {
    if (!ids.has(element.id)) return element
    const next = fn(element)
    if (next !== element) changed = true
    return next
  })
  return changed ? { ...layout, elements } : layout
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add': {
      const at = { x: clampCoord(snap(action.at.x, state.layout.grid)), y: clampCoord(snap(action.at.y, state.layout.grid)) }
      const { layout, id } = withElement(state.layout, action.kind, at)
      if (layout.elements.length > LIMITS.maxElements) return state
      return commit(state, layout, [id])
    }

    case 'select': {
      const existing = new Set(state.layout.elements.map(e => e.id))
      const ids = action.ids.filter(id => existing.has(id))
      if (action.mode === 'toggle') {
        const current = new Set(state.selection)
        for (const id of ids) {
          if (current.has(id)) current.delete(id)
          else current.add(id)
        }
        return { ...state, selection: [...current] }
      }
      return { ...state, selection: ids }
    }

    case 'selectAll':
      return { ...state, selection: state.layout.elements.map(e => e.id) }

    case 'beginGesture':
      return { ...state, past: [...state.past, state.layout].slice(-HISTORY_LIMIT), future: [] }

    case 'moveTo': {
      const ids = new Set(Object.keys(action.positions))
      const layout = mapElements(state.layout, ids, element => {
        const p = action.positions[element.id]
        const x = clampCoord(p.x)
        const y = clampCoord(p.y)
        return x === element.x && y === element.y ? element : { ...element, x, y }
      })
      return action.transient ? replace(state, layout) : commit(state, layout)
    }

    case 'moveBy': {
      const layout = mapElements(state.layout, new Set(state.selection), element => ({
        ...element, x: clampCoord(element.x + action.dx), y: clampCoord(element.y + action.dy)
      }))
      return commit(state, layout)
    }

    case 'update': {
      const layout = mapElements(state.layout, new Set([action.id]), element => {
        const patch = { ...action.patch }
        delete patch.id
        delete patch.type
        if (typeof patch.x === 'number') patch.x = clampCoord(patch.x)
        if (typeof patch.y === 'number') patch.y = clampCoord(patch.y)
        if (typeof patch.rotation === 'number') patch.rotation = normalizeRotation(patch.rotation)
        return { ...element, ...patch } as LayoutElement
      })
      return action.transient ? replace(state, layout) : commit(state, layout)
    }

    case 'updateLayout':
      return commit(state, { ...state.layout, ...action.patch })

    case 'duplicate': {
      if (state.selection.length === 0) return state
      const selected = state.layout.elements.filter(e => state.selection.includes(e.id))
      if (state.layout.elements.length + selected.length > LIMITS.maxElements) return state
      let nextId = state.layout.nextId
      const copies: LayoutElement[] = []
      const offset = { x: state.layout.grid, y: state.layout.grid }
      for (const element of selected) {
        const result = cloneElement(element, offset, nextId)
        copies.push({ ...result.element, x: clampCoord(result.element.x), y: clampCoord(result.element.y) })
        nextId = result.nextId
      }
      return commit(state, { ...state.layout, nextId, elements: [...state.layout.elements, ...copies] }, copies.map(c => c.id))
    }

    case 'delete': {
      if (state.selection.length === 0) return state
      const ids = new Set(state.selection)
      return commit(state, { ...state.layout, elements: state.layout.elements.filter(e => !ids.has(e.id)) }, [])
    }

    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return { ...state, layout: previous, past: state.past.slice(0, -1), future: [state.layout, ...state.future], selection: keepExisting(state.selection, previous) }
    }

    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return { ...state, layout: next, past: [...state.past, state.layout], future: state.future.slice(1), selection: keepExisting(state.selection, next) }
    }

    case 'saved':
      return { ...state, saved: action.layout }
  }
}

function keepExisting(selection: string[], layout: Layout): string[] {
  const ids = new Set(layout.elements.map(e => e.id))
  return selection.filter(id => ids.has(id))
}

/**
 * Antwort der Speicher-Aktionen (Vorlage: savePlanLayout, Event: saveEventLayout).
 * occupied: nur bei Events - die Änderung würde eine belegte Einheit entfernen, verkleinern oder
 * sperren (siehe app/lib/events/layout-change.ts).
 */
export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'conflict' | 'invalid' | 'forbidden' | 'occupied'; errors?: string[] }
