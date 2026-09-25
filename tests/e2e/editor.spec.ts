import { expect, test, type Page, type Request } from '@playwright/test'
import { BASE_URL, createAccount, createPlanRecord, login, prisma, uniqueIp } from './helpers'

// Raumplan-Editor (Phase 1): Bedienung per Werkzeugleiste, Tastatur und Maus, Speichern mit
// Versionsprüfung und die Berechtigungsprüfung der Speicher-Aktion.

async function openEditor(page: Page, layout?: object) {
  const user = await createAccount('CREATOR')
  await login(page, user.email)
  const plan = await createPlanRecord(user.id, { name: 'Editor-Test', layout: layout ?? { schemaVersion: 1, width: 2000, height: 1500, grid: 50, nextId: 1, elements: [] } })
  await page.goto(`/admin/plans/${plan.id}`)
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible()
  return { user, plan }
}

async function storedLayout(planId: string) {
  const plan = await prisma.floorPlan.findUniqueOrThrow({ where: { id: planId } })
  return { version: plan.version, layout: plan.layout as { elements: Record<string, unknown>[] } }
}

const elementList = (page: Page) => page.getByRole('list', { name: 'Elemente des Plans' })

test('Tisch hinzufügen, per Tastatur verschieben, rückgängig, speichern, neu laden', async ({ page }) => {
  const { plan } = await openEditor(page)
  await page.getByRole('button', { name: '+ Runder Tisch' }).click()
  await expect(elementList(page).getByRole('button', { name: /Tisch 1/ })).toHaveAttribute('aria-pressed', 'true')

  const x = page.getByLabel('X (cm)')
  const start = Number(await x.inputValue())
  await page.keyboard.press('ArrowRight')
  await expect(x).toHaveValue(String(start + 50))
  await page.keyboard.press('Alt+ArrowRight')
  await expect(x).toHaveValue(String(start + 51))
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(x).toHaveValue(String(start + 50))

  await expect(page.getByRole('status').filter({ hasText: 'Ungespeicherte Änderungen' })).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Raumplan gespeichert.')).toBeVisible()
  const saved = await storedLayout(plan.id)
  expect(saved.version).toBe(2)
  expect(saved.layout.elements[0]).toMatchObject({ id: 't1', type: 'table', x: start + 50 })

  await page.reload()
  await elementList(page).getByRole('button', { name: /Tisch 1/ }).click()
  await expect(page.getByLabel('X (cm)')).toHaveValue(String(start + 50))
})

test('Eigenschaften ändern: Plätze, Form, Beschriftung; Duplizieren und Löschen per Tastatur', async ({ page }) => {
  const { plan } = await openEditor(page)
  await page.getByRole('button', { name: '+ Eckiger Tisch' }).click()
  await page.getByLabel('Plätze', { exact: true }).fill('10')
  await page.getByLabel('Plätze', { exact: true }).press('Enter')
  await page.getByLabel('rechts').uncheck()
  await page.getByLabel('Beschriftung').fill('Ehrentisch')
  await page.getByLabel('Beschriftung').press('Enter')
  await expect(page.getByText(/1 Tische · 10 Plätze/)).toBeVisible()
  await expect(elementList(page).getByRole('button', { name: /Ehrentisch/ })).toBeVisible()

  await page.locator('body').click({ position: { x: 5, y: 5 } }) // Fokus aus dem Eingabefeld
  await elementList(page).getByRole('button', { name: /Ehrentisch/ }).click()
  await page.keyboard.press('Control+d')
  await expect(page.getByText(/2 Tische · 20 Plätze/)).toBeVisible()
  await page.keyboard.press('Delete')
  await expect(page.getByText(/1 Tische · 10 Plätze/)).toBeVisible()

  await page.getByRole('button', { name: 'Plan speichern' }).click()
  await expect(page.getByText('Raumplan gespeichert.')).toBeVisible()
  const { layout } = await storedLayout(plan.id)
  expect(layout.elements).toHaveLength(1)
  expect(layout.elements[0]).toMatchObject({ id: 't1', seats: 10, label: 'Ehrentisch', sides: { right: false } })
  expect((layout as unknown as { nextId: number }).nextId).toBe(3) // t2 war die gelöschte Kopie
})

test('Ziehen mit der Maus rastet am Raster ein; Drehgriff dreht in 15°-Schritten', async ({ page }) => {
  await openEditor(page, {
    schemaVersion: 1, width: 2000, height: 1500, grid: 50, nextId: 2,
    elements: [{ id: 't1', type: 'table', shape: 'rect', x: 1000, y: 750, rotation: 0, width: 200, height: 80, seats: 6, sides: { top: true, right: true, bottom: true, left: true }, bookable: true }]
  })
  const table = page.locator('[data-element-id="t1"] rect')
  const box = (await table.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 37, { steps: 8 })
  await page.mouse.up()

  const x = Number(await page.getByLabel('X (cm)').inputValue())
  const y = Number(await page.getByLabel('Y (cm)').inputValue())
  expect(x).toBeGreaterThan(1000)
  expect(x % 50).toBe(0)
  expect(y % 50).toBe(0)

  const handle = (await page.getByTestId('rotate-handle').boundingBox())!
  const center = (await table.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  // Nach rechts neben den Mittelpunkt ziehen: etwa 90°.
  await page.mouse.move(center.x + center.width / 2 + 200, center.y + center.height / 2 + 10, { steps: 8 })
  await page.mouse.up()
  const rotation = Number(await page.getByLabel('Drehung (°)').inputValue())
  expect(rotation % 15).toBe(0)
  expect(rotation).toBeGreaterThanOrEqual(75)
  expect(rotation).toBeLessThanOrEqual(105)

  // Eine ganze Geste ist EIN Schritt im Verlauf.
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(page.getByLabel('Drehung (°)')).toHaveValue('0')
})

test('Versionskonflikt: zweiter Tab überschreibt nicht still', async ({ page, context }) => {
  const { plan } = await openEditor(page)
  const second = await context.newPage()
  await second.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await second.goto(`/admin/plans/${plan.id}`)

  await page.getByRole('button', { name: '+ Stuhl' }).click()
  await page.getByRole('button', { name: 'Plan speichern' }).click()
  await expect(page.getByText('Raumplan gespeichert.')).toBeVisible()

  await second.getByRole('button', { name: '+ Reihenblock' }).click()
  await second.getByRole('button', { name: 'Plan speichern' }).click()
  await expect(second.getByText(/inzwischen gespeichert/)).toBeVisible()
  await expect(second.getByRole('button', { name: 'Meinen Stand herunterladen' })).toBeVisible()

  const { version, layout } = await storedLayout(plan.id)
  expect(version).toBe(2)
  expect(layout.elements.map(e => e.type)).toEqual(['seat'])
})

test('Speicher-Aktion prüft Berechtigung und Plan auf dem Server (nachgespielt, mit Positivkontrolle)', async ({ page, browser }) => {
  const { plan } = await openEditor(page)

  // Einen echten Speichervorgang mitschneiden, um Aktions-Id und Format zu kennen.
  const captured = page.waitForRequest((request: Request) => request.method() === 'POST' && !!request.headers()['next-action'])
  await page.getByRole('button', { name: '+ Stuhl' }).click()
  await page.getByRole('button', { name: 'Plan speichern' }).click()
  const request = await captured
  await expect(page.getByText('Raumplan gespeichert.')).toBeVisible()
  const actionId = request.headers()['next-action']
  const [, , savedLayout] = JSON.parse(request.postData()!) as [string, number, { elements: object[]; nextId: number }]

  async function replay(target: Page, body: unknown) {
    const cookie = (await target.context().cookies()).filter(c => c.domain === '127.0.0.1').map(c => `${c.name}=${c.value}`).join('; ')
    return target.request.post(`/admin/plans/${plan.id}`, {
      headers: { 'next-action': actionId, 'content-type': 'text/plain;charset=UTF-8', origin: BASE_URL, cookie, accept: 'text/x-component' },
      data: JSON.stringify(body)
    })
  }
  const tampered = { ...savedLayout, elements: [], nextId: savedLayout.nextId }

  // Fremdes Konto: wirkungslos.
  const stranger = await browser.newPage()
  await login(stranger, (await createAccount('CREATOR')).email)
  await replay(stranger, [plan.id, 2, tampered])
  expect((await storedLayout(plan.id)).layout.elements).toHaveLength(1)

  // Ungültiger Plan vom berechtigten Konto: abgelehnt.
  await replay(page, [plan.id, 2, { ...savedLayout, elements: [{ id: 't1', type: 'table', seats: 999 }] }])
  expect((await storedLayout(plan.id)).version).toBe(2)

  // Positivkontrolle: derselbe Aufruf mit gültigem Plan als Besitzer*in wirkt.
  await replay(page, [plan.id, 2, tampered])
  const after = await storedLayout(plan.id)
  expect(after.version).toBe(3)
  expect(after.layout.elements).toHaveLength(0)
})

test('gemeinsame Vorlage zeigt keinen Editor für andere Konten', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const plan = await createPlanRecord(owner.id, { shared: true })
  await login(page, (await createAccount('CREATOR')).email)
  await page.goto(`/admin/plans/${plan.id}`)
  await expect(page.getByRole('img', { name: /Raumplan/ })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toHaveCount(0)
})
