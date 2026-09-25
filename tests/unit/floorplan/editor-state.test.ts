import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, editorReducer, initEditor, isDirty, normalizeRotation, type EditorAction, type EditorState } from '../../../app/lib/floorplan/editor-state'
import { emptyLayout, parseLayout } from '../../../app/lib/floorplan/schema'
import { sampleLayout } from './fixtures'

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state)

describe('editorReducer', () => {
  it('Hinzufügen: am Raster eingerastet, ausgewählt, im Verlauf', () => {
    const state = run(initEditor(emptyLayout(2000, 2000)), { type: 'add', kind: { type: 'table', shape: 'round' }, at: { x: 512, y: 488 } })
    expect(state.layout.elements[0]).toMatchObject({ id: 't1', x: 500, y: 500 })
    expect(state.selection).toEqual(['t1'])
    expect(state.past).toHaveLength(1)
    expect(isDirty(state)).toBe(true)
  })

  it('Rückgängig und Wiederholen', () => {
    const start = initEditor(sampleLayout())
    const moved = run(start, { type: 'select', ids: ['t1'] }, { type: 'moveBy', dx: 50, dy: 0 })
    expect(moved.layout.elements[0].x).toBe(350)
    const undone = run(moved, { type: 'undo' })
    expect(undone.layout).toBe(start.layout)
    expect(isDirty(undone)).toBe(false)
    const redone = run(undone, { type: 'redo' })
    expect(redone.layout.elements[0].x).toBe(350)
    // Eine neue Änderung verwirft die Wiederholen-Liste.
    const branched = run(undone, { type: 'moveBy', dx: 0, dy: 50 }, { type: 'redo' })
    expect(branched.layout.elements[0]).toMatchObject({ x: 300, y: 350 })
  })

  it('Geste: ein Verlaufseintrag für viele Zwischenschritte', () => {
    let state = run(initEditor(sampleLayout()), { type: 'select', ids: ['t1'] }, { type: 'beginGesture' })
    for (let i = 1; i <= 20; i++) state = run(state, { type: 'moveTo', positions: { t1: { x: 300 + i, y: 300 } }, transient: true })
    expect(state.past).toHaveLength(1)
    expect(state.layout.elements[0].x).toBe(320)
    expect(run(state, { type: 'undo' }).layout.elements[0].x).toBe(300)
  })

  it('Duplizieren vergibt neue ids, versetzt um ein Rasterfeld und wählt die Kopien aus', () => {
    const state = run(initEditor(sampleLayout()), { type: 'select', ids: ['t1', 's3'] }, { type: 'duplicate' })
    expect(state.selection).toEqual(['t6', 's7'])
    expect(state.layout.nextId).toBe(8)
    expect(state.layout.elements.find(e => e.id === 't6')).toMatchObject({ x: 350, y: 350, seats: 8 })
    expect(parseLayout(state.layout).ok).toBe(true)
  })

  it('Löschen entfernt die Auswahl; gelöschte ids kommen nie wieder', () => {
    const state = run(initEditor(sampleLayout()), { type: 'select', ids: ['t1'] }, { type: 'delete' },
      { type: 'add', kind: { type: 'table', shape: 'rect' }, at: { x: 100, y: 100 } })
    expect(state.layout.elements.map(e => e.id)).not.toContain('t1')
    expect(state.layout.elements.map(e => e.id)).toContain('t6')
  })

  it('Update: id und Typ sind unveränderlich, Werte werden begrenzt', () => {
    const state = run(initEditor(sampleLayout()), { type: 'update', id: 't1', patch: { id: 'x9', type: 'seat', x: 1e9, rotation: -90, seats: 10 } })
    expect(state.layout.elements[0]).toMatchObject({ id: 't1', type: 'table', rotation: 270, seats: 10 })
    expect(state.layout.elements[0].x).toBeLessThanOrEqual(11000)
  })

  it('Auswahl umschalten und unbekannte ids ignorieren', () => {
    const state = run(initEditor(sampleLayout()), { type: 'select', ids: ['t1', 'gibtsnicht'] }, { type: 'select', ids: ['s3'], mode: 'toggle' },
      { type: 'select', ids: ['t1'], mode: 'toggle' })
    expect(state.selection).toEqual(['s3'])
  })

  it('Verlauf ist begrenzt', () => {
    let state = run(initEditor(sampleLayout()), { type: 'select', ids: ['t1'] })
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) state = run(state, { type: 'moveBy', dx: 1, dy: 0 })
    expect(state.past).toHaveLength(HISTORY_LIMIT)
  })

  it('saved markiert den Stand als gespeichert', () => {
    const state = run(initEditor(sampleLayout()), { type: 'select', ids: ['t1'] }, { type: 'moveBy', dx: 1, dy: 0 })
    expect(isDirty(run(state, { type: 'saved', layout: state.layout }))).toBe(false)
  })

  it('normalizeRotation', () => {
    expect([0, 90, 360, 370, -15, 359.99].map(normalizeRotation)).toEqual([0, 90, 0, 10, 345, 0])
  })
})
