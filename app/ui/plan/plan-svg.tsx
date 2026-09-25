// app/ui/plan/plan-svg.tsx
import type { PointerEvent, ReactNode } from 'react'
import { SEAT_SIZE, blockSeatPositions, tableSeatPositions } from '../../lib/floorplan/geometry'
import { rowLabel, seatNumber, tableLabel } from '../../lib/floorplan/units'
import type { Layout, LayoutElement, StaticKind } from '../../lib/floorplan/schema'

/**
 * Darstellung eines Raumplans als SVG (1 Einheit = 1 cm, viewBox = Raum). Ohne eigenen Zustand:
 * Der Editor (Phase 1) reicht Auswahl und Pointer-Handler herein, die Kundenansicht (Phase 2)
 * wird hier später die Belegung je Einheit einfärben. Beschriftungen landen als SVG-Text - React
 * maskiert sie, eingeschleustes HTML/SVG aus einem Import wird also nie ausgeführt.
 */

const STATIC_STYLE: Record<StaticKind, { fill: string; stroke: string }> = {
  stage: { fill: '#e9d5ff', stroke: '#7e22ce' },
  danceFloor: { fill: '#fef3c7', stroke: '#b45309' },
  bar: { fill: '#fed7aa', stroke: '#c2410c' },
  buffet: { fill: '#dcfce7', stroke: '#15803d' },
  door: { fill: '#e5e7eb', stroke: '#374151' },
  pillar: { fill: '#9ca3af', stroke: '#374151' },
  wall: { fill: '#4b5563', stroke: '#1f2937' },
  text: { fill: 'transparent', stroke: 'transparent' }
}

const SEAT_FILL = '#ffffff'
const SEAT_STROKE = '#475569'
const TABLE_FILL = '#f1f5f9'
const NOT_BOOKABLE = '#cbd5e1'
const SELECTED = '#2563eb'

export type PlanSvgProps = {
  layout: Layout
  /** URL des Hintergrundbilds, falls vorhanden (Lage aus layout.background). */
  backgroundUrl?: string | null
  selected?: ReadonlySet<string>
  viewBox?: { x: number; y: number; width: number; height: number }
  showGrid?: boolean
  title: string
  className?: string
  onElementPointerDown?: (event: PointerEvent<SVGGElement>, id: string) => void
  onBackgroundPointerDown?: (event: PointerEvent<SVGRectElement>) => void
  /** Zusätzliche Ebene über dem Plan (Auswahlrahmen, Drehgriff im Editor). */
  overlay?: ReactNode
  svgRef?: React.Ref<SVGSVGElement>
}

export default function PlanSvg({
  layout, backgroundUrl, selected, viewBox, showGrid = false, title, className, onElementPointerDown,
  onBackgroundPointerDown, overlay, svgRef
}: PlanSvgProps) {
  const box = viewBox ?? { x: -50, y: -50, width: layout.width + 100, height: layout.height + 100 }
  const background = backgroundUrl ? (layout.background ?? { x: 0, y: 0, width: layout.width, opacity: 0.5 }) : null
  // Gleiche Reihenfolge wie im Raum sinnvoll: Flächen unten, Plätze oben.
  const ordered = [...layout.elements].sort((a, b) => layer(a) - layer(b))

  return (
    <svg
      ref={svgRef}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      className={className}
      role="img"
      aria-label={title}
      style={{ touchAction: 'none', userSelect: 'none' }}
    >
      <title>{title}</title>
      <defs>
        <pattern id="plan-grid" width={layout.grid} height={layout.grid} patternUnits="userSpaceOnUse">
          <path d={`M ${layout.grid} 0 L 0 0 0 ${layout.grid}`} fill="none" stroke="#e2e8f0" strokeWidth={1} />
        </pattern>
      </defs>
      <rect
        x={box.x} y={box.y} width={box.width} height={box.height} fill="#f8fafc"
        onPointerDown={onBackgroundPointerDown}
      />
      <rect x={0} y={0} width={layout.width} height={layout.height} fill="#ffffff" stroke="#94a3b8" strokeWidth={4} pointerEvents="none" />
      {background && backgroundUrl && (
        <image
          href={backgroundUrl} x={background.x} y={background.y} width={background.width}
          opacity={background.opacity} preserveAspectRatio="xMinYMin meet" pointerEvents="none"
        />
      )}
      {showGrid && <rect x={0} y={0} width={layout.width} height={layout.height} fill="url(#plan-grid)" pointerEvents="none" />}

      {ordered.map(element => (
        <g
          key={element.id}
          data-element-id={element.id}
          transform={`translate(${element.x} ${element.y}) rotate(${element.rotation})`}
          onPointerDown={onElementPointerDown ? (event) => onElementPointerDown(event, element.id) : undefined}
          style={onElementPointerDown ? { cursor: 'move' } : undefined}
        >
          <ElementShape element={element} selected={selected?.has(element.id) ?? false} />
        </g>
      ))}
      {overlay}
    </svg>
  )
}

function layer(element: LayoutElement): number {
  if (element.type === 'static') return element.kind === 'text' ? 3 : 0
  return element.type === 'seatBlock' ? 1 : 2
}

/** Text, der trotz Drehung des Elements aufrecht und lesbar bleibt. */
function UprightText({ rotation, children, size = 28, y = 0, fill = '#0f172a' }: { rotation: number; children: ReactNode; size?: number; y?: number; fill?: string }) {
  return (
    <text
      transform={`rotate(${-rotation})`} y={y} fontSize={size} textAnchor="middle" dominantBaseline="central"
      fill={fill} fontFamily="system-ui, sans-serif" pointerEvents="none"
    >
      {children}
    </text>
  )
}

function ElementShape({ element, selected }: { element: LayoutElement; selected: boolean }) {
  const outline = selected ? { stroke: SELECTED, strokeWidth: 6 } : {}
  switch (element.type) {
    case 'table': {
      const bookable = element.bookable
      const seats = tableSeatPositions(element)
      const h = element.shape === 'round' ? element.width : element.height
      return (
        <>
          {seats.map((seat, index) => (
            <circle key={index} cx={seat.x} cy={seat.y} r={SEAT_SIZE / 2} fill={bookable ? SEAT_FILL : NOT_BOOKABLE} stroke={SEAT_STROKE} strokeWidth={2} />
          ))}
          {element.shape === 'rect' ? (
            <rect x={-element.width / 2} y={-h / 2} width={element.width} height={h} rx={6}
              fill={bookable ? TABLE_FILL : NOT_BOOKABLE} stroke="#334155" strokeWidth={3} {...outline} />
          ) : (
            <ellipse rx={element.width / 2} ry={h / 2} fill={bookable ? TABLE_FILL : NOT_BOOKABLE} stroke="#334155" strokeWidth={3} {...outline} />
          )}
          <UprightText rotation={element.rotation}>{tableLabel(element)}</UprightText>
        </>
      )
    }
    case 'seat':
      return (
        <>
          <circle r={SEAT_SIZE / 2} fill={element.bookable ? SEAT_FILL : NOT_BOOKABLE} stroke={SEAT_STROKE} strokeWidth={2} {...outline} />
          {element.label && <UprightText rotation={element.rotation} size={18} y={-SEAT_SIZE}>{element.label}</UprightText>}
        </>
      )
    case 'seatBlock': {
      const seats = blockSeatPositions(element)
      const firstInRow = new Map<number, (typeof seats)[number]>()
      for (const seat of seats) if (!firstInRow.has(seat.row)) firstInRow.set(seat.row, seat)
      const xs = seats.map(s => s.local.x)
      const ys = seats.map(s => s.local.y)
      const pad = SEAT_SIZE
      return (
        <>
          {seats.length > 0 && (
            <rect
              x={Math.min(...xs) - pad} y={Math.min(...ys) - pad}
              width={Math.max(...xs) - Math.min(...xs) + 2 * pad} height={Math.max(...ys) - Math.min(...ys) + 2 * pad}
              fill="transparent" stroke={selected ? SELECTED : '#cbd5e1'} strokeDasharray="12 8" strokeWidth={selected ? 6 : 2}
            />
          )}
          {seats.map(seat => (
            <circle key={`${seat.row}-${seat.position}`} cx={seat.local.x} cy={seat.local.y} r={SEAT_SIZE / 2 - 3}
              fill={element.bookable ? SEAT_FILL : NOT_BOOKABLE} stroke={SEAT_STROKE} strokeWidth={2}>
              <title>{`Reihe ${rowLabel(element, seat.row)}, Platz ${seatNumber(element, seat.position)}`}</title>
            </circle>
          ))}
          {[...firstInRow.values()].map(seat => (
            <text key={seat.row} x={seat.local.x - SEAT_SIZE} y={seat.local.y} fontSize={22} textAnchor="end"
              dominantBaseline="central" fill="#475569" fontFamily="system-ui, sans-serif" pointerEvents="none">
              {rowLabel(element, seat.row)}
            </text>
          ))}
          {element.label && seats.length > 0 && (
            <text x={0} y={Math.min(...ys) - pad - 12} fontSize={26} textAnchor="middle" fill="#334155" fontFamily="system-ui, sans-serif" pointerEvents="none">
              {element.label}
            </text>
          )}
        </>
      )
    }
    case 'static': {
      const style = STATIC_STYLE[element.kind]
      const h = element.shape === 'round' ? element.width : element.height
      const isText = element.kind === 'text'
      return (
        <>
          {element.shape === 'round' ? (
            <ellipse rx={element.width / 2} ry={h / 2} fill={style.fill} stroke={isText && selected ? SELECTED : style.stroke} strokeWidth={3} {...outline} />
          ) : (
            <rect x={-element.width / 2} y={-h / 2} width={element.width} height={h} fill={style.fill}
              stroke={isText && !selected ? 'transparent' : style.stroke} strokeWidth={3} strokeDasharray={isText ? '8 6' : undefined} {...outline} />
          )}
          {element.label && element.kind !== 'wall' && element.kind !== 'pillar' && (
            <UprightText rotation={element.rotation} size={isText ? Math.min(60, Math.max(20, h * 0.6)) : 30}>{element.label}</UprightText>
          )}
        </>
      )
    }
  }
}
