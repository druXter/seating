// app/ui/plan/editor/plan-editor.tsx
'use client'

import { useEffect, useEffectEvent, useReducer, useRef, useState, useTransition, type PointerEvent } from 'react'
import { editorReducer, initEditor, isDirty, normalizeRotation, type SaveResult } from '../../../lib/floorplan/editor-state'
import { STATIC_LABELS, type NewElementKind } from '../../../lib/floorplan/factory'
import { localSize, snap, toWorld, type Point } from '../../../lib/floorplan/geometry'
import { EXPORT_FORMAT, STATIC_KINDS, parseLayout, type Layout, type StaticKind } from '../../../lib/floorplan/schema'
import { summarize } from '../../../lib/floorplan/units'
import PlanSvg from '../plan-svg'
import Notice from '../../notice'
import PropertiesPanel, { elementTitle } from './properties-panel'

/**
 * Raumplan-Editor: SVG + Pointer Events, ohne Canvas-Framework (für einige hundert Elemente
 * reicht das, siehe docs/KONZEPT.md Abschnitt 2). Der gesamte Planzustand liegt im Reducer
 * (app/lib/floorplan/editor-state.ts); hier stehen nur Darstellung, Gesten und Tastatur.
 *
 * Gespeichert wird ausdrücklich (Button oder Strg+S). Der Server prüft den Plan erneut und
 * überschreibt nie einen Stand, den inzwischen jemand anderes gespeichert hat (Versionsprüfung).
 *
 * Genutzt für Vorlagen und für den Plan eines Events - `save` ist die jeweilige Server Action, an
 * die id gebunden (savePlanLayout bzw. saveEventLayout). Beim Event lehnt der Server zusätzlich
 * Änderungen an belegten Einheiten ab (reason 'occupied').
 */

type View = { x: number; y: number; width: number; height: number }

type Gesture =
  | { kind: 'move'; pointerId: number; start: Point; startClient: Point; origins: Record<string, Point>; started: boolean }
  | { kind: 'rotate'; pointerId: number; id: string; center: Point; started: boolean }
  | { kind: 'pan'; pointerId: number; start: Point; matrix: DOMMatrix; view: View; moved: boolean }

type Status =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string; errors?: string[] }
  | { kind: 'conflict' }

const DRAG_THRESHOLD_PX = 3

function fitView(layout: Layout): View {
  const margin = Math.max(layout.width, layout.height) * 0.05
  return { x: -margin, y: -margin, width: layout.width + 2 * margin, height: layout.height + 2 * margin }
}

function download(name: string, layout: Layout) {
  const blob = new Blob([JSON.stringify({ format: EXPORT_FORMAT, name, layout }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^\w.-]+/g, '-') || 'raumplan'}.json`
  link.click()
  URL.revokeObjectURL(url)
}

const TABLE_TOOLS: { label: string; kind: NewElementKind }[] = [
  { label: 'Runder Tisch', kind: { type: 'table', shape: 'round' } },
  { label: 'Eckiger Tisch', kind: { type: 'table', shape: 'rect' } },
  { label: 'Ovaler Tisch', kind: { type: 'table', shape: 'oval' } },
  { label: 'Stuhl', kind: { type: 'seat' } },
  { label: 'Reihenblock', kind: { type: 'seatBlock' } }
]

export default function PlanEditor({ name: planName, initialLayout, initialVersion, backgroundUrl, save: saveLayout }: {
  name: string
  initialLayout: Layout
  initialVersion: number
  backgroundUrl: string | null
  save: (baseVersion: number, layout: Layout) => Promise<SaveResult>
}) {
  const [state, dispatch] = useReducer(editorReducer, initialLayout, initEditor)
  const [version, setVersion] = useState(initialVersion)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [saving, startSaving] = useTransition()
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const [view, setView] = useState<View>(() => fitView(initialLayout))
  const [staticKind, setStaticKind] = useState<StaticKind>('stage')
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)

  const { layout, selection } = state
  const dirty = isDirty(state)
  const selectedSet = new Set(selection)
  const summary = summarize(layout)

  function toSvg(clientX: number, clientY: number, matrix?: DOMMatrix): Point {
    const svg = svgRef.current
    const inverse = matrix ?? svg?.getScreenCTM()?.inverse()
    if (!inverse) return { x: 0, y: 0 }
    const point = new DOMPoint(clientX, clientY).matrixTransform(inverse)
    return { x: point.x, y: point.y }
  }

  function viewCenter(): Point {
    const x = Math.min(layout.width, Math.max(0, view.x + view.width / 2))
    const y = Math.min(layout.height, Math.max(0, view.y + view.height / 2))
    return { x, y }
  }

  function add(kind: NewElementKind) {
    dispatch({ type: 'add', kind, at: viewCenter() })
  }

  function zoom(factor: number, around: Point = { x: view.x + view.width / 2, y: view.y + view.height / 2 }) {
    const maxSize = Math.max(layout.width, layout.height) * 3
    const width = Math.min(maxSize, Math.max(200, view.width * factor))
    const f = width / view.width
    setView({
      x: around.x - (around.x - view.x) * f,
      y: around.y - (around.y - view.y) * f,
      width,
      height: view.height * f
    })
  }

  function save() {
    const snapshot = state.layout
    const check = parseLayout(snapshot)
    if (!check.ok) {
      setStatus({ kind: 'error', message: 'Der Plan ist so nicht gültig:', errors: check.errors })
      return
    }
    startSaving(async () => {
      const result = await saveLayout(version, snapshot)
      if (result.ok) {
        setVersion(result.version)
        dispatch({ type: 'saved', layout: snapshot })
        setStatus({ kind: 'saved' })
      } else if (result.reason === 'conflict') {
        setStatus({ kind: 'conflict' })
      } else if (result.reason === 'invalid') {
        setStatus({ kind: 'error', message: 'Der Server hat den Plan abgelehnt:', errors: result.errors })
      } else if (result.reason === 'occupied') {
        setStatus({ kind: 'error', message: 'Nicht gespeichert – die Änderung betrifft belegte Tische oder Plätze:', errors: result.errors })
      } else {
        setStatus({ kind: 'error', message: 'Keine Berechtigung (mehr) für diesen Plan. Bist du noch angemeldet?' })
      }
    })
  }

  // --- Pointer-Gesten -----------------------------------------------------------------------

  function onElementPointerDown(event: PointerEvent<SVGGElement>, id: string) {
    if (event.button !== 0) return
    event.stopPropagation()
    if (event.shiftKey) {
      dispatch({ type: 'select', ids: [id], mode: 'toggle' })
      return
    }
    const ids = selectedSet.has(id) ? selection : [id]
    if (!selectedSet.has(id)) dispatch({ type: 'select', ids })
    const origins: Record<string, Point> = {}
    for (const element of layout.elements) if (ids.includes(element.id)) origins[element.id] = { x: element.x, y: element.y }
    gesture.current = {
      kind: 'move', pointerId: event.pointerId, start: toSvg(event.clientX, event.clientY),
      startClient: { x: event.clientX, y: event.clientY }, origins, started: false
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function onRotatePointerDown(event: PointerEvent<SVGCircleElement>, id: string, center: Point) {
    if (event.button !== 0) return
    event.stopPropagation()
    gesture.current = { kind: 'rotate', pointerId: event.pointerId, id, center, started: false }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function onBackgroundPointerDown(event: PointerEvent<SVGRectElement>) {
    if (event.button !== 0) return
    const matrix = svgRef.current?.getScreenCTM()?.inverse()
    if (!matrix) return
    gesture.current = { kind: 'pan', pointerId: event.pointerId, start: toSvg(event.clientX, event.clientY, matrix), matrix, view, moved: false }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return

    if (current.kind === 'pan') {
      const point = toSvg(event.clientX, event.clientY, current.matrix)
      const dx = point.x - current.start.x
      const dy = point.y - current.start.y
      if (Math.abs(dx) + Math.abs(dy) > 0) current.moved = true
      setView({ ...current.view, x: current.view.x - dx, y: current.view.y - dy })
      return
    }

    if (current.kind === 'move') {
      if (!current.started) {
        if (Math.hypot(event.clientX - current.startClient.x, event.clientY - current.startClient.y) < DRAG_THRESHOLD_PX) return
        current.started = true
        dispatch({ type: 'beginGesture' })
      }
      const point = toSvg(event.clientX, event.clientY)
      const dx = point.x - current.start.x
      const dy = point.y - current.start.y
      const positions: Record<string, Point> = {}
      for (const [id, origin] of Object.entries(current.origins)) {
        const x = origin.x + dx
        const y = origin.y + dy
        positions[id] = snapEnabled ? { x: snap(x, layout.grid), y: snap(y, layout.grid) } : { x, y }
      }
      dispatch({ type: 'moveTo', positions, transient: true })
      return
    }

    if (!current.started) {
      current.started = true
      dispatch({ type: 'beginGesture' })
    }
    const point = toSvg(event.clientX, event.clientY)
    const angle = (Math.atan2(point.y - current.center.y, point.x - current.center.x) * 180) / Math.PI + 90
    const rotation = event.shiftKey ? angle : Math.round(angle / 15) * 15
    dispatch({ type: 'update', id: current.id, patch: { rotation: normalizeRotation(rotation) }, transient: true })
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if (current.kind === 'pan' && !current.moved) dispatch({ type: 'select', ids: [] })
    gesture.current = null
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId)
  }

  // --- Mausrad-Zoom (nicht-passiver Listener, sonst lässt sich das Scrollen der Seite nicht verhindern)

  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 1.1 : 1 / 1.1
    zoom(factor, toSvg(event.clientX, event.clientY))
  })

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const listener = (event: WheelEvent) => onWheel(event)
    svg.addEventListener('wheel', listener, { passive: false })
    return () => svg.removeEventListener('wheel', listener)
  }, [])

  // --- Tastatur ------------------------------------------------------------------------------

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (mod && key === 's') {
      event.preventDefault()
      if (!saving) save()
      return
    }
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))) return

    if (mod && key === 'z') {
      event.preventDefault()
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
    } else if (mod && key === 'y') {
      event.preventDefault()
      dispatch({ type: 'redo' })
    } else if (mod && key === 'd') {
      event.preventDefault()
      dispatch({ type: 'duplicate' })
    } else if (mod && key === 'a') {
      event.preventDefault()
      dispatch({ type: 'selectAll' })
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length > 0) {
      event.preventDefault()
      dispatch({ type: 'delete' })
    } else if (event.key === 'Escape') {
      dispatch({ type: 'select', ids: [] })
    } else if (event.key.startsWith('Arrow') && selection.length > 0) {
      event.preventDefault()
      const step = event.altKey ? 1 : layout.grid
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      dispatch({ type: 'moveBy', dx, dy })
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Warnung beim Verlassen mit ungespeicherten Änderungen.
  useEffect(() => {
    if (!dirty) return
    const listener = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [dirty])

  // --- Drehgriff für ein einzelnes ausgewähltes Element ---------------------------------------

  const single = selection.length === 1 ? layout.elements.find(e => e.id === selection[0]) : undefined
  const handleRadius = view.width / 90
  let overlay = null
  if (single) {
    const size = localSize(single)
    const center = { x: single.x, y: single.y }
    const handle = toWorld({ x: 0, y: -size.height / 2 - handleRadius * 3 }, center, single.rotation)
    const edge = toWorld({ x: 0, y: -size.height / 2 }, center, single.rotation)
    overlay = (
      <g>
        <line x1={edge.x} y1={edge.y} x2={handle.x} y2={handle.y} stroke="#2563eb" strokeWidth={handleRadius / 4} pointerEvents="none" />
        <circle
          cx={handle.x} cy={handle.y} r={handleRadius} fill="#ffffff" stroke="#2563eb" strokeWidth={handleRadius / 3}
          style={{ cursor: 'grab' }} data-testid="rotate-handle"
          onPointerDown={event => onRotatePointerDown(event, single.id, center)}
        >
          <title>Ziehen zum Drehen (15°-Schritte, mit Umschalt frei)</title>
        </circle>
      </g>
    )
  }

  const button = 'border border-gray-300 rounded px-2 py-1 text-sm bg-white hover:bg-gray-50 disabled:opacity-40'

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow p-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Werkzeuge">
        {TABLE_TOOLS.map(tool => (
          <button key={tool.label} type="button" className={button} onClick={() => add(tool.kind)}>+ {tool.label}</button>
        ))}
        <span className="flex items-center gap-1">
          <label htmlFor="static-kind" className="sr-only">Objektart</label>
          <select id="static-kind" value={staticKind} onChange={event => setStaticKind(event.currentTarget.value as StaticKind)} className="border border-gray-300 rounded px-1 py-1 text-sm bg-white">
            {STATIC_KINDS.map(kind => <option key={kind} value={kind}>{STATIC_LABELS[kind]}</option>)}
          </select>
          <button type="button" className={button} onClick={() => add({ type: 'static', kind: staticKind })}>+ Objekt</button>
        </span>
        <span className="mx-1 h-6 border-l border-gray-200" aria-hidden />
        <button type="button" className={button} onClick={() => dispatch({ type: 'undo' })} disabled={state.past.length === 0} title="Strg+Z">Rückgängig</button>
        <button type="button" className={button} onClick={() => dispatch({ type: 'redo' })} disabled={state.future.length === 0} title="Strg+Umschalt+Z">Wiederholen</button>
        <button type="button" className={button} onClick={() => dispatch({ type: 'duplicate' })} disabled={selection.length === 0} title="Strg+D">Duplizieren</button>
        <button type="button" className={button} onClick={() => dispatch({ type: 'delete' })} disabled={selection.length === 0} title="Entf">Löschen</button>
        <span className="mx-1 h-6 border-l border-gray-200" aria-hidden />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={snapEnabled} onChange={e => setSnapEnabled(e.currentTarget.checked)} />Einrasten</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.currentTarget.checked)} />Raster</label>
        <button type="button" className={button} onClick={() => zoom(1 / 1.25)} aria-label="Vergrößern">+</button>
        <button type="button" className={button} onClick={() => zoom(1.25)} aria-label="Verkleinern">−</button>
        <button type="button" className={button} onClick={() => setView(fitView(layout))}>Einpassen</button>
        <span className="grow" />
        <span className="text-sm text-gray-600" role="status">
          {saving ? 'Speichert …' : dirty ? 'Ungespeicherte Änderungen' : 'Alles gespeichert'}
        </span>
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="bg-blue-600 text-white font-bold py-1 px-4 rounded hover:bg-blue-700 disabled:opacity-50" title="Strg+S">
          Plan speichern
        </button>
      </div>

      {status.kind === 'saved' && !dirty && <Notice tone="success">Raumplan gespeichert.</Notice>}
      {status.kind === 'error' && (
        <Notice tone="error">
          {status.message}
          {status.errors && <ul className="list-disc list-inside mt-1">{status.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </Notice>
      )}
      {status.kind === 'conflict' && (
        <Notice tone="warning">
          Jemand hat diesen Plan inzwischen gespeichert (anderer Tab oder anderes Konto). Deine Änderungen wurden nicht
          gespeichert, um den anderen Stand nicht zu überschreiben.
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => download(planName, layout)}>Meinen Stand herunterladen</button>
            <button type="button" className={button} onClick={() => window.location.reload()}>Neu laden (meine Änderungen verwerfen)</button>
          </div>
        </Notice>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <PlanSvg
            svgRef={svgRef}
            layout={layout}
            backgroundUrl={backgroundUrl}
            selected={selectedSet}
            viewBox={view}
            showGrid={showGrid}
            title={`Raumplan ${planName} bearbeiten`}
            className="w-full h-[70vh] block"
            onElementPointerDown={onElementPointerDown}
            onBackgroundPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            overlay={overlay}
          />
        </div>

        <aside className="space-y-3">
          <div className="bg-white rounded-lg shadow p-3">
            <PropertiesPanel layout={layout} selection={selection} dispatch={dispatch} hasBackground={backgroundUrl !== null} />
          </div>
          <div className="bg-white rounded-lg shadow p-3">
            <h3 className="text-sm font-bold mb-2">Elemente ({layout.elements.length}) · {summary.tables} Tische · {summary.seats} Plätze</h3>
            {layout.elements.length === 0 ? (
              <p className="text-xs text-gray-600">Noch leer – füge oben Tische, Stühle oder Objekte hinzu.</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto text-sm divide-y" aria-label="Elemente des Plans">
                {layout.elements.map(element => (
                  <li key={element.id}>
                    <button
                      type="button"
                      aria-pressed={selectedSet.has(element.id)}
                      onClick={event => dispatch({ type: 'select', ids: [element.id], mode: event.shiftKey ? 'toggle' : 'replace' })}
                      className={`w-full text-left px-2 py-1 rounded ${selectedSet.has(element.id) ? 'bg-blue-50 text-blue-900 font-medium' : 'hover:bg-gray-50'}`}
                    >
                      {elementTitle(element)} <span className="text-xs text-gray-500">{element.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-600 mt-2">
              Tastatur: Pfeiltasten verschieben um ein Rasterfeld (mit Alt um 1 cm), Strg+D dupliziert, Entf löscht,
              Strg+Z macht rückgängig, Strg+S speichert. Umschalt+Klick wählt mehrere aus.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
