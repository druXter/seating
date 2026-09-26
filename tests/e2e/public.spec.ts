import { expect, test } from '@playwright/test'
import { BASE_URL, cookieOf, createAccount, createBooking, createEventRecord, login, prisma, uniqueIp, uniqueSlug } from './helpers'

// Öffentliche Eventseite /<slug> (Phase 2): Sichtbarkeit nach Status, Vorschau, Belegung ohne
// personenbezogene Daten, Gruppengrößen-Filter, Listenansicht, Hintergrundbild.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** Zwei Tische (8 und 4 Plätze) und ein nicht buchbarer Tisch. */
function twoTables() {
  const table = (id: string, x: number, seats: number, bookable = true) => ({
    id, type: 'table', shape: 'round', x, y: 400, rotation: 0, width: 150, height: 150, seats,
    sides: { top: true, right: true, bottom: true, left: true }, bookable
  })
  return { schemaVersion: 1, width: 2000, height: 1000, grid: 50, nextId: 4, elements: [table('t1', 300, 8), table('t2', 900, 4), table('t3', 1500, 6, false)] }
}

test('Entwurf und Archiv: 404 ohne Zugriff (auch das Bild), Vorschau für Konten mit Zugriff', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { slug: uniqueSlug('entwurf'), title: 'Geheimes Fest' })
  await prisma.event.update({ where: { id: event.id }, data: { backgroundFile: null } })

  for (const status of ['DRAFT', 'ARCHIVED'] as const) {
    await prisma.event.update({ where: { id: event.id }, data: { status } })
    const response = await page.goto(`/${event.slug}`)
    expect(response?.status(), status).toBe(404)
    expect(await response?.text(), status).not.toContain('Geheimes Fest')
  }

  const ownerPage = await browser.newPage()
  await login(ownerPage, owner.email)
  expect((await ownerPage.goto(`/${event.slug}`))?.status()).toBe(200)
  await expect(ownerPage.getByText('Vorschau: Dieses Event ist „Archiviert“')).toBeVisible()

  // Positivkontrolle: veröffentlicht sieht es jede*r, ohne Vorschau-Hinweis.
  for (const status of ['OPEN', 'CLOSED'] as const) {
    await prisma.event.update({ where: { id: event.id }, data: { status } })
    expect((await page.goto(`/${event.slug}`))?.status(), status).toBe(200)
    await expect(page.getByRole('heading', { name: 'Geheimes Fest' })).toBeVisible()
    await expect(page.getByText('Vorschau:')).toHaveCount(0)
  }
  await expect(page.getByText('Die Buchung ist geschlossen.')).toBeVisible()
})

test('Belegung ist sichtbar, Namen und Adressen der Buchenden nie', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: twoTables() })
  await createBooking(event.id, ['t1'], { name: 'Erika Geheimname', email: 'erika.geheim@example.test', partySize: 6 })
  // Unbestätigt, aber gültig: öffentlich ebenfalls "belegt" (nicht "reserviert").
  await createBooking(event.id, ['t2'], { status: 'PENDING', expiresAt: new Date(Date.now() + 600_000), name: 'Max Verborgen', email: 'max.verborgen@example.test' })

  const response = await page.goto(`/${event.slug}`)
  const html = await response!.text()
  for (const secret of ['Erika', 'Geheimname', 'erika.geheim', 'Max Verborgen', 'max.verborgen', 'PENDING', 'CONFIRMED', 'reserviert']) {
    expect(html, secret).not.toContain(secret)
  }

  const rows = page.getByRole('table').getByRole('row')
  await expect(rows.filter({ hasText: 'Tisch 1' })).toContainText('belegt')
  await expect(rows.filter({ hasText: 'Tisch 2' })).toContainText('belegt')
  await expect(rows.filter({ hasText: 'Tisch 3' })).toContainText('nicht buchbar')
  await expect(page.locator('[data-unit-key="t1"]')).toHaveAttribute('data-state', 'confirmed')
  await expect(page.locator('[data-unit-key="t2"]')).toHaveAttribute('data-state', 'confirmed')
  await expect(page.getByText('0 von 3 Tischen frei.')).toBeVisible()
})

test('abgelaufene Reservierungen und stornierte Buchungen belegen nichts', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: twoTables() })
  await createBooking(event.id, ['t1'], { status: 'PENDING', expiresAt: new Date(Date.now() - 1000) })
  await createBooking(event.id, ['t2'], { status: 'CANCELLED' })

  await page.goto(`/${event.slug}`)
  const rows = page.getByRole('table').getByRole('row')
  await expect(rows.filter({ hasText: 'Tisch 1' })).toContainText('frei')
  await expect(rows.filter({ hasText: 'Tisch 2' })).toContainText('frei')
  await expect(page.getByText('2 von 3 Tischen frei.')).toBeVisible()
})

test('Gruppengröße hebt passende freie Tische hervor (mit Mindestbelegung)', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: twoTables(), minFillRatio: 0.5 })

  await page.goto(`/${event.slug}`)
  const input = page.getByLabel('Wie viele Personen seid ihr?')

  // 3 Personen: der 8er-Tisch verlangt mindestens 4, also passt nur der 4er.
  await input.fill('3')
  await expect(page.getByText('1 passender Tisch frei für 3 Personen.')).toBeVisible()
  await expect(page.locator('[data-unit-key="t2"]')).toHaveAttribute('opacity', '1')
  await expect(page.locator('[data-unit-key="t1"]')).toHaveAttribute('opacity', '0.3')
  await expect(page.getByRole('row').filter({ hasText: 'Tisch 1' })).toContainText('passt nicht')
  await expect(page.getByRole('row').filter({ hasText: 'Tisch 2' })).toContainText('passt')

  await input.fill('6')
  await expect(page.getByText('1 passender Tisch frei für 6 Personen.')).toBeVisible()
  await expect(page.locator('[data-unit-key="t1"]')).toHaveAttribute('opacity', '1')

  // Ist der passende Tisch belegt, gibt es keinen.
  await createBooking(event.id, ['t1'])
  await page.reload()
  await page.getByLabel('Wie viele Personen seid ihr?').fill('6')
  await expect(page.getByText('Für 6 Personen ist gerade kein passender Tisch frei.')).toBeVisible()

  await page.getByRole('button', { name: 'Filter aufheben' }).click()
  await expect(page.getByText('1 von 3 Tischen frei.')).toBeVisible()
})

test('Zoom-Knöpfe verändern den Ausschnitt', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: twoTables() })
  await page.goto(`/${event.slug}`)
  const svg = page.getByRole('img', { name: /Raumplan/ })
  const before = await svg.getAttribute('viewBox')
  await page.getByRole('button', { name: 'Plan vergrößern' }).click()
  await expect(svg).not.toHaveAttribute('viewBox', before!)
  await page.getByRole('button', { name: 'Ganzer Plan' }).click()
  await expect(svg).toHaveAttribute('viewBox', before!)
})

test('Hintergrundbild: kopiert beim Anlegen, öffentlich nur solange das Event sichtbar ist', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  await login(page, owner.email)
  const plan = await prisma.floorPlan.create({ data: { name: 'Mit Bild', ownerId: owner.id, layout: twoTables() } })
  const uploaded = await page.request.post(`/admin/plans/${plan.id}/background`, {
    multipart: { file: { name: 'grundriss.png', mimeType: 'image/png', buffer: PNG } },
    headers: { origin: BASE_URL, cookie: await cookieOf(page), 'x-forwarded-for': uniqueIp() },
    maxRedirects: 0
  })
  expect(uploaded.status()).toBe(303)

  await page.goto('/admin/events/new')
  const slug = uniqueSlug('bild')
  await page.getByLabel('Titel').fill('Mit Bild')
  await page.getByLabel('Adresse').fill(slug)
  await page.getByLabel('Raumplan (Vorlage)').selectOption({ label: 'Mit Bild' })
  await page.getByLabel('Beginn').fill('2027-01-10T18:00')
  await page.getByLabel('Ende').fill('2027-01-10T22:00')
  await page.getByRole('button', { name: 'Event anlegen' }).click()
  await expect(page.getByText('Event angelegt.')).toBeVisible()

  const event = await prisma.event.findUniqueOrThrow({ where: { slug } })
  const template = await prisma.floorPlan.findUniqueOrThrow({ where: { id: plan.id } })
  expect(event.backgroundFile).toMatch(/^[a-f0-9]{32}\.png$/)
  expect(event.backgroundFile).not.toBe(template.backgroundFile)

  const anonymous = await browser.newPage()
  expect((await anonymous.request.get(`/${slug}/background`)).status()).toBe(404)
  await prisma.event.update({ where: { id: event.id }, data: { status: 'OPEN' } })
  const image = await anonymous.request.get(`/${slug}/background`)
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toBe('image/png')
  expect(image.headers()['content-security-policy']).toBe("default-src 'none'; sandbox; frame-ancestors 'none'")
  expect(Buffer.from(await image.body()).equals(PNG)).toBe(true)
})

test('Eventseite zeigt Buchenden keinen Anmelde-Link, andere Seiten schon', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN' })
  await page.goto(`/${event.slug}`)
  await expect(page.getByRole('navigation', { name: 'Konto' }).getByRole('link', { name: 'Anmelden' })).toHaveCount(0)
  await page.goto('/impressum')
  await expect(page.getByRole('navigation', { name: 'Konto' }).getByRole('link', { name: 'Anmelden' })).toBeVisible()
})

test('unbekannte und ungültige Adressen ergeben 404', async ({ page }) => {
  for (const path of [`/${uniqueSlug('gibtsnicht')}`, '/Grossbuchstaben', '/a', '/doppel--strich']) {
    expect((await page.goto(path))?.status(), path).toBe(404)
  }
})
