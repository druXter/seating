import { createHash } from 'node:crypto'
import { PrismaClient, type BookingStatus, type EventStatus, type Role } from '@prisma/client'
import { expect, type APIResponse, type Page } from '@playwright/test'
import { hashPassword } from '../../app/lib/password'
import { deriveUnits } from '../../app/lib/floorplan/units'
import type { Layout } from '../../app/lib/floorplan/schema'
import { BASE_URL } from '../../playwright.config'

export { BASE_URL }

export const prisma = new PrismaClient()

export const PASSWORD = 'ein sicheres Testpasswort'

let counter = 0
/** Eindeutige Kennung pro Aufruf, damit sich Tests nicht über Konten oder Drossel-Zähler beeinflussen. */
function unique(): string {
  return `${Date.now().toString(36)}${(counter++).toString(36)}`
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${unique()}@example.test`
}

// Zufälliger Startwert pro Prozess: Nach einem fehlgeschlagenen Test startet Playwright einen
// neuen Worker - ein bei 0 beginnender Zähler würde dann IPs wiederverwenden, die ein
// Drossel-Test absichtlich gesperrt hat.
let ipCounter = Math.floor(Math.random() * 60_000)
/** Eindeutige Besucher-IP (Benchmark-Netz 198.18.0.0/15, RFC 2544 - nie echte Besucher). */
export function uniqueIp(): string {
  ipCounter++
  return `198.${18 + (Math.floor(ipCounter / 62_500) % 2)}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Schlüssel einer Zeile in LoginThrottle, wie app/lib/throttle.ts ihn bildet. */
export function throttleKey(scope: string, identifier: string): string {
  return sha256(`${scope}\u0000${identifier}`)
}

export async function createAccount(role: Role = 'CREATOR', options: { password?: string | null; email?: string } = {}) {
  const password = options.password === undefined ? PASSWORD : options.password
  return prisma.user.create({
    data: {
      email: options.email ?? uniqueEmail(role.toLowerCase()),
      role,
      passwordHash: password === null ? null : await hashPassword(password)
    }
  })
}

/** Meldet über das Formular an. Setzt vorher eine eigene Besucher-IP, damit Drossel-Zähler anderer Tests nicht stören. */
export async function login(page: Page, email: string, password = PASSWORD, ip = uniqueIp()) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
  await page.goto('/login')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  // Auf das Ergebnis warten (Weiterleitung oder Fehlermeldung) - ein sofort folgendes
  // page.goto würde die laufende Server Action sonst abbrechen.
  await page.waitForURL(url => url.pathname !== '/login' || url.searchParams.has('error'))
}

export type ReplayableForm = { url: string; fields: [string, string][] }

/**
 * Liest ein Server-Action-Formular aus, um es später (verändert, von einem anderen Konto
 * oder ohne Sitzung) erneut abzuschicken. WICHTIG: nur direkt nach einem frischen
 * Seitenaufruf - nach einer Client-Navigation fehlt das serverseitig gerenderte
 * $ACTION_ID-/$ACTION_REF-Feld und der Test würde nichts prüfen.
 */
export async function readForm(page: Page, selector: string): Promise<ReplayableForm> {
  await page.reload()
  const fields = await page.locator(selector).first().evaluate((form: HTMLFormElement) =>
    [...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : ''] as [string, string])
  )
  // $ACTION_ID_: einfache Server Action. $ACTION_REF_: Formular mit useActionState (die Action
  // steckt mit ihrem Zustand in weiteren versteckten Feldern, die readForm ebenfalls mitnimmt).
  expect(fields.some(([name]) => /^\$ACTION_(ID|REF)_/.test(name)), 'Formular hat keine $ACTION_ID/$ACTION_REF').toBe(true)
  return { url: page.url(), fields }
}

/**
 * Schickt ein zuvor gelesenes Formular ab, wie es ein Browser ohne JavaScript täte
 * (multipart, Origin der App). `overrides` ersetzt einzelne Felder.
 */
export async function submitForm(
  page: Page,
  form: ReplayableForm,
  overrides: Record<string, string> = {},
  headers: Record<string, string> = {}
): Promise<APIResponse> {
  const multipart: Record<string, string> = {}
  for (const [name, value] of form.fields) multipart[name] = name in overrides ? overrides[name] : value
  for (const [name, value] of Object.entries(overrides)) multipart[name] = value
  // page.request schickt Secure-Cookies (__Host-session) über http://127.0.0.1 nicht von selbst
  // mit, der Browser schon - deshalb die Cookies des Kontexts ausdrücklich als Header. Ohne
  // URL-Filter lesen: cookies(BASE_URL) ließe Secure-Cookies bei http ebenfalls weg.
  const host = new URL(BASE_URL).hostname
  const cookie = (await page.context().cookies()).filter(c => c.domain === host).map(c => `${c.name}=${c.value}`).join('; ')
  return page.request.post(form.url, {
    multipart,
    headers: { origin: BASE_URL, 'x-forwarded-for': uniqueIp(), ...(cookie ? { cookie } : {}), ...headers },
    maxRedirects: 0
  })
}

/** Hinweisbox der Seite (ohne den unsichtbaren Route-Announcer von Next.js, der ebenfalls role="alert" hat). */
export function pageAlert(page: Page) {
  return page.getByRole('main').getByRole('alert')
}

/** Ziel einer Weiterleitung als URL (relativ zur App aufgelöst). */
export function locationOf(response: APIResponse): URL | null {
  const location = response.headers()['location']
  return location ? new URL(location, BASE_URL) : null
}

/** Kleiner gültiger Plan für Tests (ein runder Tisch, ein Reihenblock, eine Bühne). */
export function testLayout() {
  return {
    schemaVersion: 1,
    width: 2000,
    height: 1500,
    grid: 50,
    nextId: 4,
    elements: [
      { id: 't1', type: 'table', shape: 'round', x: 400, y: 400, rotation: 0, width: 150, height: 150, seats: 8, sides: { top: true, right: true, bottom: true, left: true }, bookable: true },
      {
        id: 'blk2', type: 'seatBlock', x: 1200, y: 900, rotation: 0, rows: 3, seatsPerRow: 6, seatSpacing: 55, rowSpacing: 90,
        rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [3], omitted: [], curveRadius: 0, bookable: true
      },
      { id: 'o3', type: 'static', kind: 'stage', shape: 'rect', x: 1000, y: 150, rotation: 0, width: 600, height: 200, label: 'Bühne' }
    ]
  }
}

export async function createPlanRecord(ownerId: string, options: { name?: string; shared?: boolean; layout?: object } = {}) {
  return prisma.floorPlan.create({
    data: { name: options.name ?? `Plan ${uniqueEmail('p')}`, ownerId, shared: options.shared ?? false, layout: options.layout ?? testLayout() }
  })
}

export function uniqueSlug(prefix = 'event'): string {
  return `${prefix}-${unique()}`
}

/** Cookie-Header für page.request (Secure-Cookies schickt es über http://127.0.0.1 sonst nicht mit). */
export async function cookieOf(page: Page): Promise<string> {
  const host = new URL(BASE_URL).hostname
  return (await page.context().cookies()).filter(c => c.domain === host).map(c => `${c.name}=${c.value}`).join('; ')
}

/** Event direkt in der Datenbank - mit Units wie beim Anlegen über die Oberfläche. */
export async function createEventRecord(ownerId: string | null, options: {
  slug?: string; title?: string; status?: EventStatus; layout?: object; minFillRatio?: number | null; startsAt?: Date; endsAt?: Date
} = {}) {
  const layout = (options.layout ?? testLayout()) as Layout
  const startsAt = options.startsAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  return prisma.event.create({
    data: {
      slug: options.slug ?? uniqueSlug(),
      title: options.title ?? 'Testevent',
      status: options.status ?? 'DRAFT',
      startsAt,
      endsAt: options.endsAt ?? new Date(startsAt.getTime() + 5 * 60 * 60 * 1000),
      minFillRatio: options.minFillRatio ?? null,
      layout,
      ownerId,
      units: {
        createMany: {
          data: deriveUnits(layout).map(u => ({ key: u.key, kind: u.kind, label: u.label, tableKey: u.tableKey, capacity: u.capacity, bookable: u.bookable }))
        }
      }
    }
  })
}

/** Buchung mit Belegung (Phase 2 kann noch nicht buchen - die Tests legen Buchungen direkt an). */
export async function createBooking(eventId: string, unitKeys: string[], options: {
  status?: BookingStatus; expiresAt?: Date | null; partySize?: number; name?: string; email?: string
} = {}) {
  const units = await prisma.unit.findMany({ where: { eventId, key: { in: unitKeys } } })
  return prisma.booking.create({
    data: {
      eventId,
      status: options.status ?? 'CONFIRMED',
      source: 'PUBLIC',
      name: options.name ?? 'Test Person',
      email: options.email ?? uniqueEmail('gast'),
      partySize: options.partySize ?? 4,
      expiresAt: options.expiresAt ?? null,
      allocations: { create: units.map(unit => ({ eventId, unitId: unit.id })) }
    }
  })
}
