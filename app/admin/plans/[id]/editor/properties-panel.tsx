// app/admin/plans/[id]/editor/properties-panel.tsx
'use client'

import type { Dispatch, ReactNode } from 'react'
import type { EditorAction, ElementPatch } from '../../../../lib/floorplan/editor-state'
import { STATIC_LABELS } from '../../../../lib/floorplan/factory'
import { LIMITS, STATIC_KINDS, type Layout, type LayoutElement, type SeatBlockElement } from '../../../../lib/floorplan/schema'
import { elementUnits } from '../../../../lib/floorplan/units'
import { CheckboxField, NumberField, SelectField, TextField } from './fields'

const TYPE_LABELS: Record<LayoutElement['type'], string> = { table: 'Tisch', seat: 'Stuhl', seatBlock: 'Reihenblock', static: 'Objekt' }

export function elementTitle(element: LayoutElement): string {
  if (element.type === 'static') return element.label || STATIC_LABELS[element.kind]
  if (element.type === 'table') return elementUnits(element)[0].label
  return element.label || `${TYPE_LABELS[element.type]} ${element.id.replace(/^[a-z]+/, '')}`
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold">{title}</h3>
      {children}
    </section>
  )
}

/** "3, 7" -> [3, 7]: nur ganze Zahlen zwischen zwei Plätzen, sortiert, ohne Doppelte. */
function parseAisles(text: string, seatsPerRow: number): number[] {
  const values = text.split(/[,;\s]+/).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n < seatsPerRow)
  return [...new Set(values)].sort((a, b) => a - b)
}

/** "1-1, 2-5" -> ["1-1", "2-5"]: nur Positionen innerhalb des Blocks, ohne Doppelte. */
function parseOmitted(text: string, rows: number, seatsPerRow: number): string[] {
  const values = text.split(/[,;\s]+/).filter(Boolean).filter(value => {
    const match = /^([1-9][0-9]{0,2})-([1-9][0-9]{0,2})$/.exec(value)
    return match !== null && Number(match[1]) <= rows && Number(match[2]) <= seatsPerRow
  })
  return [...new Set(values)]
}

/** Nach Änderung von Reihen/Plätzen: Gänge und weggelassene Plätze außerhalb des Blocks entfernen. */
function resizeBlock(block: SeatBlockElement, rows: number, seatsPerRow: number): ElementPatch {
  return {
    rows,
    seatsPerRow,
    aisles: block.aisles.filter(a => a < seatsPerRow),
    omitted: block.omitted.filter(o => {
      const [r, s] = o.split('-').map(Number)
      return r <= rows && s <= seatsPerRow
    })
  }
}

export default function PropertiesPanel({ layout, selection, dispatch, hasBackground }: {
  layout: Layout
  selection: string[]
  dispatch: Dispatch<EditorAction>
  hasBackground: boolean
}) {
  const selected = layout.elements.filter(e => selection.includes(e.id))

  if (selected.length === 0) {
    const background = layout.background ?? { x: 0, y: 0, width: layout.width, opacity: 0.5 }
    return (
      <div className="space-y-4">
        <Section title="Raum">
          <div className="grid grid-cols-2 gap-2">
            <NumberField key={`w${layout.width}`} label="Breite" suffix="cm" value={layout.width} min={LIMITS.minRoomSize} max={LIMITS.maxRoomSize}
              onCommit={width => dispatch({ type: 'updateLayout', patch: { width } })} />
            <NumberField key={`h${layout.height}`} label="Länge" suffix="cm" value={layout.height} min={LIMITS.minRoomSize} max={LIMITS.maxRoomSize}
              onCommit={height => dispatch({ type: 'updateLayout', patch: { height } })} />
          </div>
          <NumberField key={`g${layout.grid}`} label="Raster" suffix="cm" value={layout.grid} min={1} max={500}
            onCommit={grid => dispatch({ type: 'updateLayout', patch: { grid } })} />
        </Section>
        {hasBackground && (
          <Section title="Hintergrundbild">
            <div className="grid grid-cols-2 gap-2">
              <NumberField key={`bx${background.x}`} label="Links" suffix="cm" value={background.x} min={-1000} max={LIMITS.maxRoomSize + 1000}
                onCommit={x => dispatch({ type: 'updateLayout', patch: { background: { ...background, x } } })} />
              <NumberField key={`by${background.y}`} label="Oben" suffix="cm" value={background.y} min={-1000} max={LIMITS.maxRoomSize + 1000}
                onCommit={y => dispatch({ type: 'updateLayout', patch: { background: { ...background, y } } })} />
              <NumberField key={`bw${background.width}`} label="Breite" suffix="cm" value={background.width} min={10} max={LIMITS.maxRoomSize * 2}
                onCommit={width => dispatch({ type: 'updateLayout', patch: { background: { ...background, width } } })} />
              <NumberField key={`bo${background.opacity}`} label="Deckkraft" suffix="%" value={Math.round(background.opacity * 100)} min={0} max={100}
                onCommit={opacity => dispatch({ type: 'updateLayout', patch: { background: { ...background, opacity: opacity / 100 } } })} />
            </div>
          </Section>
        )}
        <p className="text-xs text-gray-600">Klicke ein Element an oder wähle es in der Liste, um es zu bearbeiten.</p>
      </div>
    )
  }

  if (selected.length > 1) {
    return (
      <Section title={`${selected.length} Elemente ausgewählt`}>
        <p className="text-xs text-gray-600">Mit den Pfeiltasten verschieben, Strg+D dupliziert, Entf löscht.</p>
      </Section>
    )
  }

  const element = selected[0]
  const update = (patch: ElementPatch) => dispatch({ type: 'update', id: element.id, patch })
  const k = (name: string, value: unknown) => `${element.id}-${name}-${String(value)}`

  return (
    <div className="space-y-4">
      <Section title={`${TYPE_LABELS[element.type]} · ${element.id}`}>
        <TextField key={k('label', element.label)} label="Beschriftung" value={element.label ?? ''}
          placeholder={element.type === 'table' ? `Tisch ${element.id.slice(1)}` : undefined}
          onCommit={label => update({ label: label || undefined })} />
        <div className="grid grid-cols-3 gap-2">
          <NumberField key={k('x', element.x)} label="X" suffix="cm" value={element.x} min={-1000} max={LIMITS.maxRoomSize + 1000} onCommit={x => update({ x })} />
          <NumberField key={k('y', element.y)} label="Y" suffix="cm" value={element.y} min={-1000} max={LIMITS.maxRoomSize + 1000} onCommit={y => update({ y })} />
          <NumberField key={k('r', element.rotation)} label="Drehung" suffix="°" value={element.rotation} min={0} max={359} onCommit={rotation => update({ rotation })} />
        </div>
      </Section>

      {element.type === 'table' && (
        <Section title="Tisch">
          <SelectField label="Form" value={element.shape}
            options={[['round', 'rund'], ['rect', 'rechteckig'], ['oval', 'oval']] as const}
            onChange={shape => update({ shape })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField key={k('w', element.width)} label={element.shape === 'round' ? 'Durchmesser' : 'Breite'} suffix="cm" value={element.width} min={40} max={2000} onCommit={width => update({ width })} />
            {element.shape !== 'round' && (
              <NumberField key={k('h', element.height)} label="Tiefe" suffix="cm" value={element.height} min={40} max={2000} onCommit={height => update({ height })} />
            )}
          </div>
          <NumberField key={k('seats', element.seats)} label="Plätze" value={element.seats} min={0} max={LIMITS.maxSeatsPerTable} onCommit={seats => update({ seats })} />
          {element.shape === 'rect' && (
            <fieldset className="grid grid-cols-2 gap-1">
              <legend className="text-xs text-gray-700 mb-1">Plätze an den Seiten</legend>
              {([['top', 'oben'], ['right', 'rechts'], ['bottom', 'unten'], ['left', 'links']] as const).map(([side, text]) => {
                const active = Object.values(element.sides).filter(Boolean).length
                const isLastActive = element.sides[side] && active === 1
                return (
                  <label key={side} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={element.sides[side]} disabled={isLastActive}
                      onChange={event => update({ sides: { ...element.sides, [side]: event.currentTarget.checked } })} />
                    {text}
                  </label>
                )
              })}
            </fieldset>
          )}
          <CheckboxField label="Buchbar" checked={element.bookable} onChange={bookable => update({ bookable })} />
        </Section>
      )}

      {element.type === 'seat' && (
        <Section title="Stuhl">
          <CheckboxField label="Buchbar" checked={element.bookable} onChange={bookable => update({ bookable })} />
        </Section>
      )}

      {element.type === 'seatBlock' && (
        <Section title="Reihenblock">
          <div className="grid grid-cols-2 gap-2">
            <NumberField key={k('rows', element.rows)} label="Reihen" value={element.rows} min={1} max={LIMITS.maxRows}
              onCommit={rows => update(resizeBlock(element, rows, element.seatsPerRow))} />
            <NumberField key={k('spr', element.seatsPerRow)} label="Plätze je Reihe" value={element.seatsPerRow} min={1} max={LIMITS.maxSeatsPerRow}
              onCommit={seatsPerRow => update(resizeBlock(element, element.rows, seatsPerRow))} />
            <NumberField key={k('ss', element.seatSpacing)} label="Platzabstand" suffix="cm" value={element.seatSpacing} min={30} max={300} onCommit={seatSpacing => update({ seatSpacing })} />
            <NumberField key={k('rs', element.rowSpacing)} label="Reihenabstand" suffix="cm" value={element.rowSpacing} min={40} max={400} onCommit={rowSpacing => update({ rowSpacing })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Reihen" value={element.rowLabels} options={[['letters', 'A, B, C …'], ['numbers', '1, 2, 3 …']] as const}
              onChange={rowLabels => update({ rowLabels })} />
            <NumberField key={k('rowStart', element.rowStart)} label="Erste Reihe (Nr.)" value={element.rowStart} min={1} max={200} onCommit={rowStart => update({ rowStart })} />
            <SelectField label="Platznummern" value={element.numbering} options={[['ltr', 'von links'], ['rtl', 'von rechts']] as const}
              onChange={numbering => update({ numbering })} />
            <NumberField key={k('seatStart', element.seatStart)} label="Erster Platz (Nr.)" value={element.seatStart} min={1} max={1000} onCommit={seatStart => update({ seatStart })} />
          </div>
          <TextField key={k('aisles', element.aisles.join())} label="Gänge nach Platz (Position von links, z. B. 4, 12)" value={element.aisles.join(', ')}
            onCommit={text => update({ aisles: parseAisles(text, element.seatsPerRow) })} />
          <TextField key={k('omitted', element.omitted.join())} label="Weggelassene Plätze (Reihe-Position, z. B. 1-1, 1-2)" value={element.omitted.join(', ')} maxLength={5000}
            onCommit={text => update({ omitted: parseOmitted(text, element.rows, element.seatsPerRow) })} />
          <NumberField key={k('curve', element.curveRadius)} label="Krümmung: Radius (0 = gerade)" suffix="cm" value={element.curveRadius} min={0} max={100000}
            onCommit={curveRadius => update({ curveRadius })} />
          <CheckboxField label="Buchbar" checked={element.bookable} onChange={bookable => update({ bookable })} />
        </Section>
      )}

      {element.type === 'static' && (
        <Section title="Objekt">
          <SelectField label="Art" value={element.kind} options={STATIC_KINDS.map(kind => [kind, STATIC_LABELS[kind]] as const)}
            onChange={kind => update({ kind })} />
          <SelectField label="Form" value={element.shape} options={[['rect', 'eckig'], ['round', 'rund']] as const} onChange={shape => update({ shape })} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField key={k('w', element.width)} label={element.shape === 'round' ? 'Durchmesser' : 'Breite'} suffix="cm" value={element.width} min={5} max={LIMITS.maxRoomSize} onCommit={width => update({ width })} />
            {element.shape === 'rect' && (
              <NumberField key={k('h', element.height)} label="Tiefe" suffix="cm" value={element.height} min={5} max={LIMITS.maxRoomSize} onCommit={height => update({ height })} />
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
