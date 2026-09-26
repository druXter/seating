// app/ui/plan/plan-viewer.tsx
'use client'

import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react'
import type { Layout } from '../../lib/floorplan/schema'
import PlanSvg, { type UnitVisual } from './plan-svg'

/**
 * Nur-Lese-Ansicht eines Plans mit Zoom und Verschieben, touchtauglich (die meisten buchen am
 * Handy). Bewusst "kooperative" Gesten wie bei eingebetteten Karten: Ein Finger scrollt weiter die
 * Seite (sonst bliebe man im Plan hängen), zwei Finger zoomen und verschieben; mit der Maus zieht
 * man, Strg + Mausrad zoomt. Dazu Knöpfe für alle, die keine Gesten nutzen können.
 */

type View = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }

type Gesture =
  | { kind: 'pan'; pointerId: number; start: Point; startClient: Point; matrix: DOMMatrix; view: View }
  | { kind: 'pinch'; distance: number; worldMid: Point; matrix: DOMMatrix; view: View }

function fitView(layout: Layout): View {
  const margin = Math.max(layout.width, layout.height) * 0.03
  return { x: -margin, y: -margin, width: layout.width + 2 * margin, height: layout.height + 2 * margin }
}

function apply(matrix: DOMMatrix, x: number, y: number): Point {
  const p = new DOMPoint(x, y).matrixTransform(matrix)
  return { x: p.x, y: p.y }
}

export default function PlanViewer({ layout, backgroundUrl, units, title, onUnitClick }: {
  layout: Layout
  backgroundUrl: string | null
  units: ReadonlyMap<string, UnitVisual>
  title: string
  /** Klick/Tipp auf eine Einheit (nicht nach dem Verschieben). Tastatur: über die Liste. */
  onUnitClick?: (key: string) => void
}) {
  const [view, setView] = useState<View>(() => fitView(layout))
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)
  // Nach einem Verschieben/Zoomen feuert der Browser trotzdem "click" - der ist dann keine Auswahl.
  const suppressClick = useRef(false)
  const fitted = fitView(layout)

  function clampWidth(width: number): number {
    return Math.min(fitted.width * 1.5, Math.max(fitted.width / 12, width))
  }

  function zoom(factor: number, around: Point = { x: view.x + view.width / 2, y: view.y + view.height / 2 }) {
    const width = clampWidth(view.width * factor)
    const f = width / view.width
    setView({ x: around.x - (around.x - view.x) * f, y: around.y - (around.y - view.y) * f, width, height: view.height * f })
  }

  function inverse(): DOMMatrix | null {
    return svgRef.current?.getScreenCTM()?.inverse() ?? null
  }

  function startPinch() {
    const matrix = inverse()
    const [a, b] = [...pointers.current.values()]
    if (!matrix || !a || !b) return
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    gesture.current = { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, worldMid: apply(matrix, mid.x, mid.y), matrix, view }
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return
      const matrix = inverse()
      if (!matrix) return
      suppressClick.current = false
      gesture.current = {
        kind: 'pan', pointerId: event.pointerId, start: apply(matrix, event.clientX, event.clientY),
        startClient: { x: event.clientX, y: event.clientY }, matrix, view
      }
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    if (pointers.current.size === 0) suppressClick.current = false
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      suppressClick.current = true
      startPinch()
    }
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current
    if (event.pointerType !== 'mouse') {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (current?.kind !== 'pinch' || pointers.current.size !== 2) return
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const width = clampWidth(current.view.width * (current.distance / distance))
      const s = width / current.view.width
      // Der Punkt unter der Mitte zwischen den Fingern bleibt unter der (neuen) Mitte.
      const mid = apply(current.matrix, (a.x + b.x) / 2, (a.y + b.y) / 2)
      setView({
        x: current.worldMid.x - s * (mid.x - current.view.x),
        y: current.worldMid.y - s * (mid.y - current.view.y),
        width,
        height: current.view.height * s
      })
      return
    }
    if (current?.kind !== 'pan' || current.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - current.startClient.x, event.clientY - current.startClient.y) > 4) suppressClick.current = true
    const point = apply(current.matrix, event.clientX, event.clientY)
    setView({ ...current.view, x: current.view.x - (point.x - current.start.x), y: current.view.y - (point.y - current.start.y) })
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId)
    const current = gesture.current
    if (current?.kind === 'pan' && current.pointerId === event.pointerId) gesture.current = null
    if (current?.kind === 'pinch' && pointers.current.size < 2) gesture.current = null
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId)
  }

  // Nur mit Strg (bzw. Pinch auf dem Trackpad, das Browser als Strg+Mausrad melden) - sonst würde
  // der Plan das normale Scrollen der Seite verschlucken.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const matrix = inverse()
    zoom(event.deltaY > 0 ? 1.1 : 1 / 1.1, matrix ? apply(matrix, event.clientX, event.clientY) : undefined)
  })

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const listener = (event: WheelEvent) => onWheel(event)
    svg.addEventListener('wheel', listener, { passive: false })
    return () => svg.removeEventListener('wheel', listener)
  }, [])

  const button = 'border border-gray-300 rounded px-3 py-1 text-sm bg-white hover:bg-gray-50'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={() => zoom(1 / 1.25)} aria-label="Plan vergrößern">+</button>
        <button type="button" className={button} onClick={() => zoom(1.25)} aria-label="Plan verkleinern">−</button>
        <button type="button" className={button} onClick={() => setView(fitView(layout))}>Ganzer Plan</button>
        <span className="text-xs text-gray-600">Zoomen mit zwei Fingern oder Strg + Mausrad, verschieben durch Ziehen.</span>
      </div>
      <div className="border border-gray-200 rounded overflow-hidden bg-white">
        <PlanSvg
          svgRef={svgRef}
          layout={layout}
          backgroundUrl={backgroundUrl}
          viewBox={view}
          units={units}
          title={title}
          touchAction="pan-x pan-y"
          className="w-full max-h-[70vh] min-h-56 block cursor-grab active:cursor-grabbing"
          style={{ aspectRatio: `${fitted.width} / ${fitted.height}` }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={onPointerDown}
          onClick={onUnitClick ? event => {
            if (suppressClick.current) return
            const key = (event.target as Element).closest('[data-unit-key]')?.getAttribute('data-unit-key')
            if (key) onUnitClick(key)
          } : undefined}
        />
      </div>
    </div>
  )
}
