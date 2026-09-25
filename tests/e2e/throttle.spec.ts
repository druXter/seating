import { expect, test, type Page } from '@playwright/test'
import {
  PASSWORD, createAccount, locationOf, prisma, readForm, submitForm, throttleKey, uniqueEmail, uniqueIp,
  type ReplayableForm
} from './helpers'

// Login-Drosselung (app/lib/throttle.ts): 10 Fehlversuche pro E-Mail, 20 pro IP in 15 Minuten.
// Die Anfragen gehen direkt als Formular-POST raus (schneller als über die Oberfläche) - mit
// eigener X-Forwarded-For-Adresse pro Szenario; der Testserver läuft mit TRUST_PROXY_HOPS=1.

async function loginForm(page: Page): Promise<ReplayableForm> {
  await page.goto('/login')
  return readForm(page, 'form:has(input[name="password"])')
}

async function attempt(page: Page, form: ReplayableForm, email: string, password: string, forwardedFor: string) {
  const response = await submitForm(page, form, { email, password }, { 'x-forwarded-for': forwardedFor })
  expect(response.status()).toBe(303)
  const target = locationOf(response)!
  if (target.pathname === '/admin') return 'ok'
  return target.searchParams.get('error') === 'locked' ? 'locked' : 'wrong'
}

test('Positivkontrolle: derselbe POST mit richtigem Passwort meldet an', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const form = await loginForm(page)
  expect(await attempt(page, form, user.email, PASSWORD, uniqueIp())).toBe('ok')
})

test('Sperre pro E-Mail beim 11. Versuch - auch mit richtigem Passwort und von anderen IPs', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const form = await loginForm(page)
  for (let i = 1; i <= 10; i++) {
    expect(await attempt(page, form, user.email, 'falsches Passwort', uniqueIp()), `Versuch ${i}`).toBe('wrong')
  }
  expect(await attempt(page, form, user.email, PASSWORD, uniqueIp())).toBe('locked')
})

test('Sperre pro IP beim 21. Versuch; erfundene Einträge links in X-Forwarded-For helfen nicht', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const ip = uniqueIp()
  const form = await loginForm(page)
  for (let i = 1; i <= 20; i++) {
    // Links steht, was der Client selbst mitschickt - bei einem Proxy zählt nur der letzte Eintrag.
    expect(await attempt(page, form, uniqueEmail('spray'), 'falsches Passwort', `10.66.0.${i}, ${ip}`), `Versuch ${i}`).toBe('wrong')
  }
  expect(await attempt(page, form, user.email, PASSWORD, `10.66.1.1, ${ip}`)).toBe('locked')
  // Positivkontrolle: dieselbe Anmeldung von einer anderen IP klappt.
  expect(await attempt(page, form, user.email, PASSWORD, uniqueIp())).toBe('ok')

  // In der Datenbank steht nur der Hash, nicht die IP.
  const row = await prisma.loginThrottle.findUnique({ where: { key: throttleKey('login:ip', ip) } })
  expect(row?.count).toBeGreaterThanOrEqual(21)
  expect(await prisma.loginThrottle.count({ where: { key: { contains: ip } } })).toBe(0)
})

test('30 gleichzeitige Versuche: höchstens 10 erreichen die Passwortprüfung', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const form = await loginForm(page)
  const results = await Promise.all(
    Array.from({ length: 30 }, () => attempt(page, form, user.email, 'falsches Passwort', uniqueIp()))
  )
  const checked = results.filter(r => r === 'wrong').length
  expect(checked).toBeLessThanOrEqual(10)
  expect(checked).toBeGreaterThan(0)
  expect(results.filter(r => r === 'locked').length).toBe(30 - checked)
})

test('Passwort vergessen: neutrale Antwort, gedrosselt, Admins bekommen keinen Link', async ({ page }) => {
  const admin = await createAccount('ADMIN')
  const creator = await createAccount('CREATOR')
  await page.goto('/forgot-password')
  const form = await readForm(page, 'form:has(input[name="email"])')

  for (const email of [uniqueEmail('unbekannt'), admin.email, creator.email]) {
    const response = await submitForm(page, form, { email })
    expect(locationOf(response)?.search, email).toBe('?sent=1')
  }
  expect((await prisma.user.findUnique({ where: { id: admin.id } }))?.resetTokenHash).toBeNull()
  expect((await prisma.user.findUnique({ where: { id: creator.id } }))?.resetTokenHash).not.toBeNull()

  // Höchstens 3 Links pro Adresse und Stunde - danach bleibt der letzte Link bestehen.
  const target = await createAccount('CREATOR')
  const hashes = new Set<string | null>()
  for (let i = 1; i <= 5; i++) {
    const response = await submitForm(page, form, { email: target.email })
    expect(locationOf(response)?.search).toBe('?sent=1')
    hashes.add((await prisma.user.findUnique({ where: { id: target.id } }))!.resetTokenHash)
  }
  expect(hashes.size).toBe(3)
})
