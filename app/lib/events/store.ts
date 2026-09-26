// app/lib/events/store.ts
import { cache } from 'react'
import { notFound } from 'next/navigation'
import type { Event, EventStatus } from '@prisma/client'
import { prisma } from '../prisma'
import { eventLevel, type EventLevel } from '../permissions'
import type { CurrentUser } from '../auth'
import { parseLayout, type Layout } from '../floorplan/schema'
import { unitStates, type StateUnit, type UnitState } from './occupancy'

export type LoadedEvent = Omit<Event, 'layout'> & { layout: Layout; level: EventLevel }

function withLayout<T extends { id: string; layout: unknown }>(event: T): (Omit<T, 'layout'> & { layout: Layout }) | null {
  // Wie bei Vorlagen beim Lesen erneut geprüft (siehe app/lib/floorplan/store.ts).
  const parsed = parseLayout(event.layout)
  if (!parsed.ok) {
    console.error(`[events] Gespeicherter Plan von Event ${event.id} ist ungültig:`, parsed.errors)
    return null
  }
  return { ...event, layout: parsed.layout }
}

/**
 * Lädt ein Event für ein Konto oder gibt null zurück, wenn es das Event nicht gibt ODER das Konto
 * keinen Zugriff hat - nach außen gleich (keine Bestätigung fremder ids). Über diese Funktion
 * gehen alle Admin-Seiten, Server Actions und Route Handler für Events.
 */
export async function loadEventForUser(id: string, user: CurrentUser): Promise<LoadedEvent | null> {
  if (!id) return null
  const event = await prisma.event.findUnique({ where: { id } })
  if (!event) return null
  const share = event.ownerId === user.id || user.role === 'ADMIN'
    ? null
    : await prisma.eventAccess.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } }, select: { id: true } })
  const level = eventLevel(user, event, share !== null)
  if (!level) return null
  const loaded = withLayout(event)
  return loaded ? { ...loaded, level } : null
}

export async function loadEventOr404(id: string, user: CurrentUser): Promise<LoadedEvent> {
  const event = await loadEventForUser(id, user)
  if (!event) notFound()
  return event
}

/** Öffentlich sichtbar sind nur veröffentlichte und geschlossene Events (Entwurf/Archiv: 404). */
export function isPubliclyVisible(status: EventStatus): boolean {
  return status === 'OPEN' || status === 'CLOSED'
}

/** Event per Slug (öffentliche Seite). Pro Anfrage gecacht - Seite und Metadaten teilen die Abfrage. */
export const loadEventBySlug = cache(async (slug: string) => {
  const event = await prisma.event.findUnique({ where: { slug } })
  return event ? withLayout(event) : null
})

export type EventUnit = StateUnit & { label: string; capacity: number }

/**
 * Einheiten eines Events mit ihrem aktuellen Zustand. Liest nur, was die Belegung braucht - Namen
 * und Kontaktdaten der Buchenden werden hier bewusst NICHT abgefragt.
 */
export async function loadUnitStates(eventId: string, now = new Date()): Promise<{ units: EventUnit[]; states: Map<string, UnitState> }> {
  const [units, allocations] = await Promise.all([
    prisma.unit.findMany({
      where: { eventId },
      select: { key: true, kind: true, tableKey: true, bookable: true, label: true, capacity: true }
    }),
    prisma.allocation.findMany({
      where: { eventId },
      select: { unit: { select: { key: true } }, booking: { select: { status: true, expiresAt: true } } }
    })
  ])
  const states = unitStates(
    units,
    allocations.map(a => ({ unitKey: a.unit.key, status: a.booking.status, expiresAt: a.booking.expiresAt })),
    now
  )
  return { units, states }
}
