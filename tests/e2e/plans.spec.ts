import { readFile, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  createAccount, createPlanRecord, locationOf, login, pageAlert, prisma, readForm, submitForm, testLayout
} from './helpers'

// Raumplan-Vorlagen (Phase 1): Anlegen, Import/Export, Freigabe als Vorlage, Berechtigungen.
// Jeder Angriffsfall mit Positivkontrolle durch ein berechtigtes Konto.

async function loggedIn(page: Page, role: 'ADMIN' | 'CREATOR' | 'MODERATOR' = 'CREATOR') {
  const user = await createAccount(role)
  await login(page, user.email)
  return user
}

test('leeren Plan anlegen, umbenennen, als Vorlage anbieten', async ({ page }) => {
  const user = await loggedIn(page)
  await page.goto('/admin/plans/new')
  await page.getByLabel('Name', { exact: true }).fill('Festsaal')
  await page.getByLabel('Breite (m)').fill('25')
  await page.getByLabel('Länge (m)').fill('18.5')
  await page.getByRole('button', { name: 'Leeren Raumplan anlegen' }).click()
  await expect(page).toHaveURL(/\/admin\/plans\/[a-z0-9]+$/)
  await expect(page.getByRole('heading', { name: 'Festsaal' })).toBeVisible()

  const plan = await prisma.floorPlan.findFirstOrThrow({ where: { ownerId: user.id } })
  expect(plan.layout).toMatchObject({ schemaVersion: 1, width: 2500, height: 1850, elements: [] })

  await page.getByLabel('Name', { exact: true }).fill('Großer Festsaal')
  await page.getByLabel('Als gemeinsame Vorlage anbieten').check()
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page).toHaveURL(/settings=1/)
  expect(await prisma.floorPlan.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ name: 'Großer Festsaal', shared: true, version: 1 })
})

test('ungültige Raumgröße wird serverseitig abgelehnt', async ({ page }) => {
  const user = await loggedIn(page)
  await page.goto('/admin/plans/new')
  await page.getByLabel('Name', { exact: true }).fill('Riesig')
  await page.getByLabel('Breite (m)').evaluate(el => el.removeAttribute('max'))
  await page.getByLabel('Breite (m)').fill('500')
  await page.getByRole('button', { name: 'Leeren Raumplan anlegen' }).click()
  await expect(pageAlert(page)).toContainText('zwischen 1 und 100 m')
  expect(await prisma.floorPlan.count({ where: { ownerId: user.id } })).toBe(0)
})

test('Export und Re-Import ergeben denselben Plan', async ({ page }, testInfo) => {
  const user = await loggedIn(page)
  const plan = await createPlanRecord(user.id, { name: 'Hörsaal M001' })

  const response = await page.request.get(`/admin/plans/${plan.id}/export`, {
    headers: { cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') }
  })
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toContain('attachment')
  expect(response.headers()['cache-control']).toContain('no-store')
  const exported = await response.json()
  expect(exported).toMatchObject({ format: 'seating-floorplan', name: 'Hörsaal M001', layout: testLayout() })

  const file = testInfo.outputPath('export.json')
  await writeFile(file, JSON.stringify(exported))
  await page.goto('/admin/plans/new')
  await page.getByLabel('Export-Datei (.json)').setInputFiles(file)
  await page.getByRole('button', { name: 'Importieren' }).click()
  await expect(page).toHaveURL(/imported=1/)
  await expect(page.getByRole('heading', { name: 'Hörsaal M001' })).toBeVisible()

  const plans = await prisma.floorPlan.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'asc' } })
  expect(plans).toHaveLength(2)
  expect(plans[1].layout).toEqual(plans[0].layout)
  expect(await readFile(file, 'utf8')).toContain('"schemaVersion":1')
})

test('ungültiger Import wird mit Fehlern abgelehnt, nichts angelegt', async ({ page }, testInfo) => {
  const user = await loggedIn(page)
  const cases: [string, string, RegExp][] = [
    ['kein-json.json', 'kein json {', /kein gültiges JSON/],
    ['fremd.json', JSON.stringify({ hallo: 'welt' }), /keine Raumplan-Datei/],
    ['kaputt.json', JSON.stringify({ format: 'seating-floorplan', layout: { ...testLayout(), nextId: 1 } }), /nextId/],
    ['doppelt.json', JSON.stringify({ format: 'seating-floorplan', layout: { ...testLayout(), elements: [testLayout().elements[0], testLayout().elements[0]] } }), /Doppelte id/]
  ]
  for (const [name, content, message] of cases) {
    const file = testInfo.outputPath(name)
    await writeFile(file, content)
    await page.goto('/admin/plans/new')
    await page.getByLabel('Export-Datei (.json)').setInputFiles(file)
    await page.getByRole('button', { name: 'Importieren' }).click()
    await expect(pageAlert(page).first(), name).toContainText(message)
  }
  expect(await prisma.floorPlan.count({ where: { ownerId: user.id } })).toBe(0)
})

test('Beschriftungen aus einem Import werden als Text ausgegeben, nie als HTML', async ({ page }) => {
  const user = await loggedIn(page)
  const layout = testLayout()
  const payload = '<img src=x onerror="window.__xss=1">'
  ;(layout.elements[0] as { label?: string }).label = payload
  const plan = await createPlanRecord(user.id, { layout, name: '<b>fett</b>' })
  await page.goto(`/admin/plans/${plan.id}`)
  await expect(page.getByRole('heading', { name: '<b>fett</b>' })).toBeVisible()
  await expect(page.locator('svg text', { hasText: payload })).toHaveCount(1)
  expect(await page.locator('img[src="x"]').count()).toBe(0)
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
})

test('fremder privater Plan: 404 für Seite und Export; Löschen/Einstellungen/Duplizieren wirkungslos', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const plan = await createPlanRecord(owner.id, { name: 'Privat' })
  await page.goto('/admin/plans')
  const deleteForm = await readForm(page, 'form:has(button:text("Löschen"))')
  const duplicateForm = await readForm(page, 'form:has(button:text("Duplizieren"))')
  await page.goto(`/admin/plans/${plan.id}`)
  const settingsForm = await readForm(page, 'form:has(input[name="shared"])')

  const stranger = await browser.newPage()
  const strangerUser = await loggedIn(stranger)
  expect((await stranger.goto(`/admin/plans/${plan.id}`))?.status()).toBe(404)
  expect((await stranger.request.get(`/admin/plans/${plan.id}/export`, {
    headers: { cookie: (await stranger.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') }
  })).status()).toBe(404)
  await expect(stranger.goto('/admin/plans').then(() => stranger.getByText('Privat').count())).resolves.toBe(0)

  await submitForm(stranger, settingsForm, { planId: plan.id, name: 'Gekapert', shared: 'on' })
  await submitForm(stranger, duplicateForm, { planId: plan.id })
  await submitForm(stranger, deleteForm, { planId: plan.id })
  expect(await prisma.floorPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ name: 'Privat', shared: false })
  expect(await prisma.floorPlan.count({ where: { ownerId: strangerUser.id } })).toBe(0)

  // Positivkontrolle: dieselben POSTs als Besitzer*in wirken.
  await submitForm(page, settingsForm, { planId: plan.id, name: 'Umbenannt', shared: 'on' })
  expect(await prisma.floorPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ name: 'Umbenannt', shared: true })
  const deleted = await submitForm(page, deleteForm, { planId: plan.id })
  expect(locationOf(deleted)?.search).toBe('?deleted=1')
  expect(await prisma.floorPlan.findUnique({ where: { id: plan.id } })).toBeNull()
})

test('gemeinsame Vorlage: andere Creator sehen, exportieren und duplizieren – ändern und löschen nicht', async ({ page, browser }) => {
  const owner = await loggedIn(page)
  const plan = await createPlanRecord(owner.id, { name: 'Gemeinsamer Saal', shared: true })
  await page.goto('/admin/plans')
  const deleteForm = await readForm(page, 'form:has(button:text("Löschen"))')
  await page.goto(`/admin/plans/${plan.id}`)
  const settingsForm = await readForm(page, 'form:has(input[name="shared"])')

  const other = await browser.newPage()
  const otherUser = await loggedIn(other)
  await other.goto(`/admin/plans/${plan.id}`)
  await expect(other.getByText('Gemeinsame Vorlage von')).toBeVisible()
  await expect(other.getByLabel('Als gemeinsame Vorlage anbieten')).toHaveCount(0)

  await submitForm(other, settingsForm, { planId: plan.id, name: 'Gekapert' })
  await submitForm(other, deleteForm, { planId: plan.id })
  expect(await prisma.floorPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ name: 'Gemeinsamer Saal' })

  await other.getByRole('button', { name: 'Duplizieren' }).click()
  await expect(other.getByRole('heading', { name: 'Kopie von Gemeinsamer Saal' })).toBeVisible()
  const copy = await prisma.floorPlan.findFirstOrThrow({ where: { ownerId: otherUser.id } })
  expect(copy).toMatchObject({ shared: false })
  expect(copy.layout).toEqual(plan.layout)
})

test('Moderator*innen haben keinen Zugriff auf Raumpläne, auch nicht auf gemeinsame Vorlagen', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const plan = await createPlanRecord(owner.id, { shared: true })
  await loggedIn(page, 'MODERATOR')
  await page.goto('/admin/plans')
  await expect(page).toHaveURL(/\/admin$/)
  expect((await page.goto(`/admin/plans/${plan.id}`))?.status()).toBe(404)
})

test('Admin sieht und bearbeitet alle Pläne; gelöschtes Konto übergibt seine Pläne', async ({ page }) => {
  const creator = await createAccount('CREATOR')
  const plan = await createPlanRecord(creator.id, { name: 'Vom Creator' })
  const admin = await loggedIn(page, 'ADMIN')
  await page.goto(`/admin/plans/${plan.id}`)
  await expect(page.getByLabel('Als gemeinsame Vorlage anbieten')).toBeVisible()

  await page.goto('/admin/users')
  page.once('dialog', dialog => dialog.accept())
  await page.locator('li', { hasText: creator.email }).getByRole('button', { name: 'Löschen' }).click()
  await expect(page.locator('li', { hasText: creator.email })).toHaveCount(0)
  expect(await prisma.floorPlan.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ ownerId: admin.id })
})
