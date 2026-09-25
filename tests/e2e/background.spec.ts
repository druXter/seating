import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { TEST_UPLOAD_DIR } from '../../playwright.config'
import { BASE_URL, createAccount, createPlanRecord, locationOf, login, prisma, uniqueIp } from './helpers'

// Hintergrundbild (Phase 1): Upload über einen Route Handler mit eigener Origin-, Anmelde- und
// Rechteprüfung, Erkennung am Inhalt, Auslieferung nur an Berechtigte.

// Kleinstes gültiges PNG (1×1 Pixel).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function cookieOf(page: Page) {
  return (await page.context().cookies()).filter(c => c.domain === '127.0.0.1').map(c => `${c.name}=${c.value}`).join('; ')
}

async function upload(page: Page, planId: string, file: { name: string; mimeType: string; buffer: Buffer }, origin = BASE_URL) {
  return page.request.post(`/admin/plans/${planId}/background`, {
    multipart: { file },
    headers: { origin, cookie: await cookieOf(page), 'x-forwarded-for': uniqueIp() },
    maxRedirects: 0
  })
}

async function stored(planId: string) {
  return prisma.floorPlan.findUniqueOrThrow({ where: { id: planId }, select: { backgroundFile: true, backgroundType: true } })
}

test('Upload über die Seite, Auslieferung mit sicheren Headern, Entfernen löscht die Datei', async ({ page }, testInfo) => {
  const owner = await createAccount('CREATOR')
  await login(page, owner.email)
  const plan = await createPlanRecord(owner.id)
  await page.goto(`/admin/plans/${plan.id}`)

  const file = testInfo.outputPath('grundriss.png')
  await (await import('node:fs/promises')).writeFile(file, PNG)
  await page.getByLabel('Bilddatei').setInputFiles(file)
  await page.getByRole('button', { name: 'Bild hochladen' }).click()
  await expect(page.getByText('Hintergrundbild gespeichert.')).toBeVisible()

  const { backgroundFile, backgroundType } = await stored(plan.id)
  expect(backgroundFile).toMatch(/^[a-f0-9]{32}\.png$/)
  expect(backgroundType).toBe('image/png')
  expect(existsSync(join(TEST_UPLOAD_DIR, backgroundFile!))).toBe(true)
  await expect(page.locator('svg image')).toHaveAttribute('href', new RegExp(`/admin/plans/${plan.id}/background`))

  const image = await page.request.get(`/admin/plans/${plan.id}/background`, { headers: { cookie: await cookieOf(page) } })
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toBe('image/png')
  expect(image.headers()['x-content-type-options']).toBe('nosniff')
  expect(image.headers()['content-security-policy']).toContain('sandbox')
  expect(Buffer.from(await image.body()).equals(PNG)).toBe(true)

  await page.getByRole('button', { name: 'Hintergrundbild entfernen' }).click()
  await expect(page.getByText('Hintergrundbild entfernt.')).toBeVisible()
  expect(await stored(plan.id)).toEqual({ backgroundFile: null, backgroundType: null })
  expect(existsSync(join(TEST_UPLOAD_DIR, backgroundFile!))).toBe(false)
})

test('nur PNG/JPEG/WebP nach Inhalt, Größenlimit', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  await login(page, owner.email)
  const plan = await createPlanRecord(owner.id)

  const rejected: [string, string, Buffer][] = [
    ['bild.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['getarnt.png', 'image/png', Buffer.from('<html><script>alert(1)</script></html>')],
    ['animiert.gif', 'image/gif', Buffer.from('GIF89a\x01\x00\x01\x00')]
  ]
  for (const [name, mimeType, buffer] of rejected) {
    const response = await upload(page, plan.id, { name, mimeType, buffer })
    expect(locationOf(response)?.search, name).toBe('?background=type')
  }
  const tooBig = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
  expect(locationOf(await upload(page, plan.id, { name: 'gross.png', mimeType: 'image/png', buffer: tooBig }))?.search).toBe('?background=size')
  expect((await stored(plan.id)).backgroundFile).toBeNull()

  // Positivkontrolle: gültiges PNG unter irreführendem Namen/Typ wird am Inhalt erkannt.
  const ok = await upload(page, plan.id, { name: 'grundriss.gif', mimeType: 'image/gif', buffer: PNG })
  expect(locationOf(ok)?.search).toBe('?background=uploaded')
  expect((await stored(plan.id)).backgroundType).toBe('image/png')
})

test('fremde Konten und fremde Herkunft können nicht hochladen oder abrufen', async ({ page, browser }) => {
  const owner = await createAccount('CREATOR')
  await login(page, owner.email)
  const plan = await createPlanRecord(owner.id)
  const file = { name: 'grundriss.png', mimeType: 'image/png', buffer: PNG }

  const stranger = await browser.newPage()
  await login(stranger, (await createAccount('CREATOR')).email)
  expect((await upload(stranger, plan.id, file)).status()).toBe(404)

  const anonymous = await browser.newPage()
  expect((await upload(anonymous, plan.id, file)).status()).toBe(401)

  // Cross-Site-Formular mit gültiger Sitzung der Besitzerin: abgelehnt.
  expect((await upload(page, plan.id, file, 'https://evil.example')).status()).toBe(403)
  expect((await stored(plan.id)).backgroundFile).toBeNull()

  // Positivkontrolle
  expect(locationOf(await upload(page, plan.id, file))?.search).toBe('?background=uploaded')

  expect((await stranger.request.get(`/admin/plans/${plan.id}/background`, { headers: { cookie: await cookieOf(stranger) } })).status()).toBe(404)
  expect((await anonymous.request.get(`/admin/plans/${plan.id}/background`)).status()).toBe(401)

  // Als gemeinsame Vorlage darf ein anderes Konto das Bild sehen (aber weiterhin nicht ersetzen).
  await prisma.floorPlan.update({ where: { id: plan.id }, data: { shared: true } })
  expect((await stranger.request.get(`/admin/plans/${plan.id}/background`, { headers: { cookie: await cookieOf(stranger) } })).status()).toBe(200)
  expect((await upload(stranger, plan.id, file)).status()).toBe(404)
})

test('Duplizieren kopiert das Bild, Löschen des Plans löscht es', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  await login(page, owner.email)
  const plan = await createPlanRecord(owner.id, { name: 'Mit Bild' })
  await upload(page, plan.id, { name: 'grundriss.png', mimeType: 'image/png', buffer: PNG })
  const original = (await stored(plan.id)).backgroundFile!

  await page.goto(`/admin/plans/${plan.id}`)
  await page.getByRole('button', { name: 'Plan duplizieren' }).click()
  await expect(page.getByRole('heading', { name: 'Kopie von Mit Bild' })).toBeVisible()
  const copy = await prisma.floorPlan.findFirstOrThrow({ where: { ownerId: owner.id, name: 'Kopie von Mit Bild' } })
  expect(copy.backgroundFile).toMatch(/^[a-f0-9]{32}\.png$/)
  expect(copy.backgroundFile).not.toBe(original)

  await page.goto('/admin/plans')
  page.once('dialog', dialog => dialog.accept())
  await page.locator('li', { hasText: /^Mit Bild/ }).getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByText('Raumplan gelöscht.')).toBeVisible()
  expect(existsSync(join(TEST_UPLOAD_DIR, original))).toBe(false)
  expect(existsSync(join(TEST_UPLOAD_DIR, copy.backgroundFile!))).toBe(true)
})
