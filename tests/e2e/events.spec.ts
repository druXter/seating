import { expect, test, type Page, type Request } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import {
  BASE_URL, cookieOf, createAccount, createBooking, createEventRecord, createPlanRecord, locationOf, login, pageAlert, prisma,
  readForm, submitForm, testLayout, uniqueSlug
} from './helpers'

// Events (Phase 2): Anlegen mit Plan-Snapshot, Einstellungen, Plan des Events mit Schutz belegter
// Einheiten, Freigaben, Löschen. Jeder Angriffsfall mit Positivkontrolle durch ein berechtigtes Konto.

async function loggedIn(page: Page, role: 'ADMIN' | 'CREATOR' | 'MODERATOR' = 'CREATOR') {
  const user = await createAccount(role)
  await login(page, user.email)
  return user
}

type StoredLayout = { elements: { id: string; label?: string; seats?: number }[] }

async function storedEvent(id: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id } })
  return { ...event, layout: event.layout as StoredLayout }
}

test('Event aus Vorlage anlegen: Adresse aus dem Titel, Snapshot, Einheiten, Entwurf', async ({ page }) => {
  const user = await loggedIn(page)
  const plan = await createPlanRecord(user.id, { name: 'Festsaal' })
  const title = `Winterball ${Date.now()}`

  await page.goto('/admin/events/new')
  await page.getByLabel('Titel').fill(title)
  await expect(page.getByLabel('Adresse')).toHaveValue(`winterball-${title.split(' ')[1]}`)
  await page.getByLabel('Raumplan (Vorlage)').selectOption({ label: 'Festsaal' })
  await page.getByLabel('Beginn').fill('2026-12-12T19:00')
  await page.getByLabel('Ende').fill('2026-12-13T01:00')
  await page.getByLabel('Ort').fill('Festsaal, Hauptstraße 1')
  await page.getByRole('button', { name: 'Event anlegen' }).click()
  await expect(page).toHaveURL(/\/admin\/events\/[a-z0-9]+\?created=1$/)
  await expect(page.getByText('Event angelegt.')).toBeVisible()
  await expect(page.getByTestId('table-counts')).toHaveText('Tische: 1 frei · 0 reserviert (unbestätigt) · 0 belegt')

  const event = await prisma.event.findFirstOrThrow({ where: { ownerId: user.id }, include: { units: true } })
  expect(event).toMatchObject({ title, status: 'DRAFT', mode: 'TABLE', access: 'OPEN', sourcePlanId: plan.id, location: 'Festsaal, Hauptstraße 1' })
  expect(event.startsAt.toISOString()).toBe('2026-12-12T18:00:00.000Z')
  // 1 Tisch mit 8 Plätzen + Reihenblock 3 × 6.
  expect(event.units).toHaveLength(1 + 8 + 18)
  expect(event.units.find(u => u.key === 't1')).toMatchObject({ kind: 'TABLE', capacity: 8, label: 'Tisch 1', bookable: true })
  expect(event.units.find(u => u.key === 't1-s3')).toMatchObject({ kind: 'SEAT', tableKey: 't1' })

  // Snapshot: Änderungen an der Vorlage erreichen das Event nicht.
  await prisma.floorPlan.update({ where: { id: plan.id }, data: { layout: { ...testLayout(), elements: [] }, version: { increment: 1 } } })
  expect((await storedEvent(event.id)).layout.elements).toHaveLength(3)
})

test('Adresse: reserviert, ungültig und doppelt werden serverseitig abgelehnt', async ({ page }) => {
  const user = await loggedIn(page)
  await createPlanRecord(user.id, { name: 'Saal' })
  const taken = await createEventRecord(user.id, { slug: uniqueSlug('vergeben') })

  async function tryCreate(slug: string) {
    await page.goto('/admin/events/new')
    await page.getByLabel('Titel').fill('Test')
    await page.getByLabel('Adresse').evaluate(el => el.removeAttribute('pattern'))
    await page.getByLabel('Adresse').fill(slug)
    await page.getByLabel('Raumplan (Vorlage)').selectOption({ label: 'Saal' })
    await page.getByLabel('Beginn').fill('2026-12-12T19:00')
    await page.getByLabel('Ende').fill('2026-12-12T23:00')
    await page.getByRole('button', { name: 'Event anlegen' }).click()
  }

  await tryCreate('admin')
  await expect(pageAlert(page)).toContainText('reserviert')
  await tryCreate('Mit Leerzeichen')
  await expect(pageAlert(page)).toContainText('Kleinbuchstaben')
  await tryCreate(taken.slug)
  await expect(pageAlert(page)).toContainText('schon vergeben')
  expect(await prisma.event.count({ where: { ownerId: user.id } })).toBe(1)
})

test('Einstellungen speichern und veröffentlichen', async ({ page, browser }) => {
  const user = await loggedIn(page)
  const event = await createEventRecord(user.id, { slug: uniqueSlug('einstellungen') })
  const anonymous = await browser.newPage()
  expect((await anonymous.goto(`/${event.slug}`))?.status()).toBe(404)

  await page.goto(`/admin/events/${event.id}`)
  await page.getByLabel('Status').selectOption('OPEN')
  await page.getByLabel('Titel').fill('Sommerfest')
  await page.getByLabel('Mindestbelegung eines Tisches in % (optional)').fill('50')
  await page.getByLabel('Buchung ab (optional)').fill('2026-11-01T10:00')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()

  const saved = await storedEvent(event.id)
  expect(saved).toMatchObject({ status: 'OPEN', title: 'Sommerfest', minFillRatio: 0.5, slug: event.slug })
  expect(saved.bookingOpensAt?.toISOString()).toBe('2026-11-01T09:00:00.000Z')
  expect((await anonymous.goto(`/${event.slug}`))?.status()).toBe(200)
  await expect(anonymous.getByRole('heading', { name: 'Sommerfest' })).toBeVisible()
})

test('Plan des Events: belegter Tisch lässt sich umbenennen, aber nicht löschen', async ({ page }) => {
  const user = await loggedIn(page)
  const event = await createEventRecord(user.id)
  await createBooking(event.id, ['t1'], { partySize: 6 })

  await page.goto(`/admin/events/${event.id}/plan`)
  const list = page.getByRole('list', { name: 'Elemente des Plans' })
  await list.getByRole('button', { name: /Tisch 1/ }).click()
  await page.keyboard.press('Delete')
  await page.getByRole('button', { name: 'Plan speichern' }).click()
  await expect(pageAlert(page)).toContainText('Tisch 1 ist belegt und kann nicht entfernt werden.')
  expect((await storedEvent(event.id)).layout.elements.map(e => e.id)).toContain('t1')

  // Positivkontrolle: Umbenennen geht.
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await list.getByRole('button', { name: /Tisch 1/ }).click()
  await page.getByLabel('Beschriftung').fill('Ehrentisch')
  await page.getByLabel('Beschriftung').press('Enter')
  await page.getByRole('button', { name: 'Plan speichern' }).click()
  await expect(page.getByText('Raumplan gespeichert.')).toBeVisible()
  expect((await storedEvent(event.id)).layout.elements.find(e => e.id === 't1')?.label).toBe('Ehrentisch')
  expect((await prisma.unit.findFirstOrThrow({ where: { eventId: event.id, key: 't1' } })).label).toBe('Ehrentisch')
})

test('Speicher-Aktion für Event-Pläne (nachgespielt): fremdes Konto, belegte Einheiten, abgelaufene Holds, Positivkontrolle', async ({ page, browser }) => {
  const user = await loggedIn(page)
  const event = await createEventRecord(user.id)
  await createBooking(event.id, ['t1'], { partySize: 6 })
  const expired = await createBooking(event.id, ['blk2-r1-s1'], { status: 'PENDING', expiresAt: new Date(Date.now() - 60_000), partySize: 1 })

  // Einen echten Speichervorgang mitschneiden (Aktions-Id und Format).
  await page.goto(`/admin/events/${event.id}/plan`)
  const captured = page.waitForRequest((request: Request) => request.method() === 'POST' && !!request.headers()['next-action'])
  await page.getByRole('button', { name: '+ Stuhl' }).click()
  await page.getByRole('button', { name: 'Plan speichern' }).click()
  const request = await captured
  await expect(page.getByText('Raumplan gespeichert.')).toBeVisible()
  const actionId = request.headers()['next-action']
  const [, , savedLayout] = JSON.parse(request.postData()!) as [string, number, { elements: { id: string; type: string; seats?: number; rows?: number }[] }]

  async function replay(target: Page, body: unknown) {
    return target.request.post(`/admin/events/${event.id}/plan`, {
      headers: { 'next-action': actionId, 'content-type': 'text/plain;charset=UTF-8', origin: BASE_URL, cookie: await cookieOf(target), accept: 'text/x-component' },
      data: JSON.stringify(body)
    })
  }
  const withoutTables = { ...savedLayout, elements: savedLayout.elements.filter(e => e.type !== 'table') }
  const smallerTable = { ...savedLayout, elements: savedLayout.elements.map(e => (e.id === 't1' ? { ...e, seats: 4 } : e)) }

  // Fremdes Konto: wirkungslos.
  const stranger = await browser.newPage()
  await login(stranger, (await createAccount('CREATOR')).email)
  await replay(stranger, [event.id, 2, withoutTables])
  expect((await storedEvent(event.id)).layoutVersion).toBe(2)

  // Belegten Tisch löschen oder unter 6 Plätze verkleinern: auch als Besitzer*in abgelehnt.
  await replay(page, [event.id, 2, withoutTables])
  await replay(page, [event.id, 2, smallerTable])
  let stored = await storedEvent(event.id)
  expect(stored.layoutVersion).toBe(2)
  expect(stored.layout.elements.find(e => e.id === 't1')?.seats).toBe(8)
  expect(await prisma.unit.count({ where: { eventId: event.id, key: 't1' } })).toBe(1)

  // Positivkontrolle: Der Reihenblock war nur durch einen abgelaufenen Hold "belegt" - Entfernen
  // geht, der Hold wird dabei als verfallen markiert.
  const withoutBlock = { ...savedLayout, elements: savedLayout.elements.filter(e => e.type !== 'seatBlock') }
  await replay(page, [event.id, 2, withoutBlock])
  stored = await storedEvent(event.id)
  expect(stored.layoutVersion).toBe(3)
  expect(stored.layout.elements.some(e => e.id === 'blk2')).toBe(false)
  expect(await prisma.unit.count({ where: { eventId: event.id, key: { startsWith: 'blk2-' } } })).toBe(0)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe('EXPIRED')
  expect(await prisma.allocation.count({ where: { bookingId: expired.id } })).toBe(0)
})

test('Plan aus Vorlage neu übernehmen - abgelehnt, wenn die Vorlage nicht zur Belegung passt', async ({ page }) => {
  const user = await loggedIn(page)
  const plan = await createPlanRecord(user.id, { name: 'Vorlage' })
  const event = await prisma.event.update({ where: { id: (await createEventRecord(user.id)).id }, data: { sourcePlanId: plan.id } })
  page.on('dialog', dialog => dialog.accept())

  // Vorlage ohne Tisch 1, der im Event belegt ist.
  const layout = testLayout()
  await prisma.floorPlan.update({ where: { id: plan.id }, data: { layout: { ...layout, elements: layout.elements.filter(e => e.id !== 't1') } } })
  const booking = await createBooking(event.id, ['t1'])
  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('button', { name: 'Plan aus Vorlage neu übernehmen' }).click()
  await expect(pageAlert(page)).toContainText('Tisch 1 ist belegt')
  expect((await storedEvent(event.id)).layout.elements).toHaveLength(3)

  // Positivkontrolle: ohne die Belegung wird übernommen.
  await prisma.booking.delete({ where: { id: booking.id } })
  await page.reload()
  await page.getByRole('button', { name: 'Plan aus Vorlage neu übernehmen' }).click()
  await expect(page.getByText('Plan aus der Vorlage übernommen.')).toBeVisible()
  expect((await storedEvent(event.id)).layout.elements.map(e => e.id)).toEqual(['blk2', 'o3'])
  expect(await prisma.unit.count({ where: { eventId: event.id, key: { startsWith: 't1' } } })).toBe(0)
})

test('Freigabe: Moderator*in erst mit Freigabe, dann bearbeiten - aber nie löschen oder weiter freigeben', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id, { slug: uniqueSlug('freigabe') })
  const moderator = await createAccount('MODERATOR')
  const modPage = await browser.newPage()
  await login(modPage, moderator.email)

  // Formulare als Besitzer*in lesen (frischer Seitenaufruf, siehe readForm).
  await page.goto(`/admin/events/${event.id}`)
  const settings = await readForm(page, 'form:has(select[name="status"])')
  const share = await readForm(page, 'form:has(input[name="email"])')
  const remove = await readForm(page, 'form:has(button:text("Event löschen"))')

  // Ohne Freigabe: keine Seite, keine Aktion, keine Vorschau des Entwurfs.
  expect((await modPage.goto(`/admin/events/${event.id}`))?.status()).toBe(404)
  expect((await modPage.goto(`/${event.slug}`))?.status()).toBe(404)
  await submitForm(modPage, settings, { title: 'Übernommen' })
  expect((await storedEvent(event.id)).title).toBe('Testevent')

  // Freigeben über die Oberfläche.
  await page.getByPlaceholder('E-Mail-Adresse des Kontos').fill(moderator.email)
  await page.getByRole('button', { name: 'Freigeben' }).click()
  await expect(page.getByText('Freigabe hinzugefügt.')).toBeVisible()

  await modPage.goto('/admin/events')
  await modPage.getByRole('link', { name: 'Testevent' }).click()
  await expect(modPage.getByRole('button', { name: 'Einstellungen speichern' })).toBeVisible()
  await expect(modPage.getByRole('heading', { name: 'Freigaben' })).toHaveCount(0)
  await expect(modPage.getByRole('heading', { name: 'Event löschen' })).toHaveCount(0)
  expect((await modPage.goto(`/${event.slug}`))?.status()).toBe(200)
  await expect(modPage.getByText('Vorschau:')).toBeVisible()

  // Mit Freigabe wirkt die Einstellungs-Aktion ...
  await submitForm(modPage, settings, { title: 'Von Moderation geändert' })
  expect((await storedEvent(event.id)).title).toBe('Von Moderation geändert')
  // ... Löschen und Weiter-Freigeben aber nicht.
  const third = await createAccount('CREATOR')
  await submitForm(modPage, share, { email: third.email })
  await submitForm(modPage, remove)
  expect(await prisma.eventAccess.count({ where: { eventId: event.id, userId: third.id } })).toBe(0)
  expect(await prisma.event.count({ where: { id: event.id } })).toBe(1)

  // Positivkontrolle: dieselben POSTs als Besitzer*in wirken.
  await submitForm(page, share, { email: third.email })
  expect(await prisma.eventAccess.count({ where: { eventId: event.id, userId: third.id } })).toBe(1)

  // Freigabe entziehen - danach wieder kein Zugriff.
  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('listitem').filter({ hasText: moderator.email }).getByRole('button', { name: 'Entfernen' }).click()
  await expect(page.getByText('Freigabe entfernt.')).toBeVisible()
  expect((await modPage.goto(`/admin/events/${event.id}`))?.status()).toBe(404)

  const deleted = await submitForm(page, remove)
  expect(locationOf(deleted)?.pathname).toBe('/admin/events')
  expect(await prisma.event.count({ where: { id: event.id } })).toBe(0)
})

test('Fremdes Konto: Seite 404, nachgespielte Aktionen wirkungslos, Admin darf alles', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id)
  await page.goto(`/admin/events/${event.id}`)
  const settings = await readForm(page, 'form:has(select[name="status"])')

  const stranger = await browser.newPage()
  await login(stranger, (await createAccount('CREATOR')).email)
  expect((await stranger.goto(`/admin/events/${event.id}`))?.status()).toBe(404)
  expect((await stranger.goto(`/admin/events/${event.id}/plan`))?.status()).toBe(404)
  expect((await stranger.request.get(`/admin/events/${event.id}/background`, { headers: { cookie: await cookieOf(stranger) } })).status()).toBe(404)
  await submitForm(stranger, settings, { status: 'OPEN' })
  expect((await storedEvent(event.id)).status).toBe('DRAFT')

  // Nicht angemeldet: Weiterleitung zum Login, keine Änderung.
  const anonymous = await browser.newPage()
  expect(locationOf(await submitForm(anonymous, settings, { status: 'OPEN' }))?.pathname).toBe('/login')
  expect((await storedEvent(event.id)).status).toBe('DRAFT')

  // Positivkontrolle: Admin ohne Freigabe.
  const admin = await browser.newPage()
  await login(admin, (await createAccount('ADMIN')).email)
  await submitForm(admin, settings, { status: 'OPEN' })
  expect((await storedEvent(event.id)).status).toBe('OPEN')
})

test('Löschen entfernt Buchungen, Belegungen und Freigaben mit', async ({ page }) => {
  const owner = await loggedIn(page)
  const event = await createEventRecord(owner.id)
  await createBooking(event.id, ['t1'])
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: (await createAccount('MODERATOR')).id } })
  page.on('dialog', dialog => dialog.accept())

  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByText('Es hat 1 aktive Buchung')).toBeVisible()
  await page.getByRole('button', { name: 'Event löschen' }).click()
  await expect(page.getByText('Event gelöscht.')).toBeVisible()
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(0)
  expect(await prisma.allocation.count({ where: { eventId: event.id } })).toBe(0)
  expect(await prisma.unit.count({ where: { eventId: event.id } })).toBe(0)
  expect(await prisma.eventAccess.count({ where: { eventId: event.id } })).toBe(0)
})

test('Moderator*innen können keine Events anlegen', async ({ page }) => {
  await loggedIn(page, 'MODERATOR')
  await page.goto('/admin/events/new')
  await expect(page).toHaveURL(/\/admin\/events$/)
  await expect(page.getByRole('link', { name: 'Neues Event' })).toHaveCount(0)
})

test('Konto löschen: Events gehen an den löschenden Admin über', async ({ page }) => {
  const admin = await loggedIn(page, 'ADMIN')
  const creator = await createAccount('CREATOR')
  const event = await createEventRecord(creator.id)
  await page.goto('/admin/users')
  const deleteForm = await readForm(page, 'form:has(button:text("Löschen"))')
  await submitForm(page, deleteForm, { userId: creator.id })
  expect(await prisma.user.findUnique({ where: { id: creator.id } })).toBeNull()
  expect((await storedEvent(event.id)).ownerId).toBe(admin.id)
})

test('Cron löscht Events 18 Monate nach Ende, jüngere bleiben; Konten mit Events bleiben', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const month = 30 * 24 * 60 * 60 * 1000
  const old = await createEventRecord(owner.id, { startsAt: new Date(Date.now() - 20 * month), endsAt: new Date(Date.now() - 19 * month) })
  await createBooking(old.id, ['t1'])
  const recent = await createEventRecord(owner.id, { startsAt: new Date(Date.now() - 17 * month), endsAt: new Date(Date.now() - 17 * month + 3600_000) })
  await prisma.user.update({ where: { id: owner.id }, data: { lastLoginAt: new Date(Date.now() - 3 * 365 * 24 * 3600_000) } })

  const response = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)
  expect(await prisma.event.count({ where: { id: old.id } })).toBe(0)
  expect(await prisma.booking.count({ where: { eventId: old.id } })).toBe(0)
  expect(await prisma.event.count({ where: { id: recent.id } })).toBe(1)
  expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1)
})
