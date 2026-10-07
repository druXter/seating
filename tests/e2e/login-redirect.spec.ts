import { expect, test, type Page } from '@playwright/test'
import { BASE_URL, REDIRECT_PORT } from '../../playwright.config'
import { createAccount, PASSWORD, uniqueEmail, uniqueIp } from './helpers'
import { setIdentity, SUITE_TOOLS } from './suite-server'

// Bevorzugter Anbieter (SUITE_LOGIN_REDIRECT, Idee Q5 der Suite): Die zweite Instanz aus
// playwright.config.ts hat Tool A als bevorzugten Anbieter. Ihre Login-Seite leitet ohne Sitzung
// direkt dorthin; der Rücksprung geht über BASE_URL an die erste Instanz (gleiche Datenbank, und
// Cookies sind nicht an Ports gebunden). In der ersten Instanz ist nichts davon zu sehen.

const SEATING = new URL(BASE_URL).origin
const REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}`
let counter = 0
const person = () => ({ sub: `redirect-${Date.now().toString(36)}-${++counter}`, email: uniqueEmail('redirect'), name: 'Weitergeleitet', role: 'CREATOR' })

const atSeating = (page: Page) => page.waitForURL(url => url.origin === SEATING && !url.pathname.startsWith('/api/suite'))
const passwordField = (page: Page) => page.getByLabel('Passwort')

test.afterEach(() => setIdentity('a', null))

test('Login-Seite leitet direkt zum bevorzugten Anbieter und meldet an', async ({ page }) => {
  setIdentity('a', person())
  await page.goto(`${REDIRECT}/login`)
  await atSeating(page)
  expect(new URL(page.url()).pathname).toBe('/admin')
})

test('next bleibt erhalten, auch über einen Client-Link (echter Seitenwechsel)', async ({ page }) => {
  setIdentity('a', person())
  await page.goto(`${REDIRECT}/login?next=${encodeURIComponent('/account')}`)
  await atSeating(page)
  expect(new URL(page.url()).pathname).toBe('/account')

  // Abgemeldet über die Startseite: Der Link "Anmelden" ist ein Next-Link
  await page.context().clearCookies()
  await page.goto(`${REDIRECT}/`)
  await page.getByRole('link', { name: 'Anmelden für Veranstalter*innen' }).click()
  await atSeating(page)
  expect(new URL(page.url()).pathname).toBe('/admin')
})

test('beim Anbieter niemand angemeldet: man landet dort', async ({ page }) => {
  await page.goto(`${REDIRECT}/login`)
  await page.waitForURL(url => url.origin === SUITE_TOOLS.a.origin)
  await expect(page.getByText('Bei diesem Tool ist niemand angemeldet.')).toBeVisible()
})

test('Formular statt Weiterleitung: nach Fehler, Reset, mit local und wenn Seating selbst Anbieter ist', async ({ page }) => {
  setIdentity('a', person())
  const authorize = `/api/suite/authorize?app=${encodeURIComponent(SUITE_TOOLS.a.origin)}&state=${'s'.repeat(43)}`
  for (const query of ['?error=sso', '?error=not-linked', '?reset=1', '?local=1', `?next=${encodeURIComponent(authorize)}`]) {
    await page.goto(`${REDIRECT}/login${query}`)
    await expect(passwordField(page), query).toBeVisible()
    expect(new URL(page.url()).origin, query).toBe(REDIRECT)
  }
  // Positivkontrolle: derselbe Browser ohne Parameter wird weitergeleitet
  await page.goto(`${REDIRECT}/login`)
  await atSeating(page)
})

test('lokaler Login bleibt erreichbar (ohne JavaScript sichtbar) und funktioniert', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(`${REDIRECT}/login`)
  await expect(page.getByRole('heading', { name: 'Anmelden mit Tool A' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'hier weiter' })).toHaveAttribute('href', `/api/suite/login?idp=${encodeURIComponent(SUITE_TOOLS.a.origin)}&next=%2Fadmin`)
  await page.getByRole('link', { name: 'Stattdessen mit E-Mail und Passwort anmelden' }).click()
  await expect(passwordField(page)).toBeVisible()
  await context.close()

  const account = await createAccount('CREATOR')
  const js = await browser.newPage()
  await js.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await js.goto(`${REDIRECT}/login?local=1`)
  await js.getByLabel('E-Mail').fill(account.email)
  await passwordField(js).fill(PASSWORD)
  await js.getByRole('button', { name: 'Anmelden' }).click()
  await js.waitForURL(url => url.pathname === '/admin')
  await js.close()
})

test('ohne SUITE_LOGIN_REDIRECT (erste Instanz) bleibt alles beim Alten', async ({ page }) => {
  setIdentity('a', person())
  await page.goto('/login')
  await expect(passwordField(page)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mit Tool A anmelden' })).toBeVisible()
})
