import { expect, test } from '@playwright/test'
import { BASE_URL, createAccount, login } from './helpers'

// Installierbare App (PWA): Manifest und Icons, Header des Service Workers, Registrierung in der
// Produktion (die Tests laufen gegen `next start`), Offline-Seite - und dass der Worker nichts
// Persönliches zwischenspeichert.

test('Manifest mit Icons, Shortcuts und Start im Admin-Bereich; Seitenkopf verweist darauf', async ({ page, request }) => {
  const response = await request.get('/manifest.webmanifest')
  expect(response.status()).toBe(200)
  const manifest = await response.json()
  expect(manifest).toMatchObject({ name: 'Seating', start_url: '/admin', scope: '/', display: 'standalone', lang: 'de', theme_color: '#2563eb' })
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(['/admin/events', '/admin/events/new', '/admin/plans'])

  for (const icon of [...manifest.icons.map((i: { src: string }) => i.src), '/favicon.ico', '/apple-icon.png']) {
    const file = await request.get(icon)
    expect(file.status(), icon).toBe(200)
    expect(file.headers()['content-type'], icon).toMatch(/^image\//)
  }

  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#2563eb')
})

test('Service Worker: nie gecacht, eigene CSP; Offline-Seite nicht einbettbar', async ({ request }) => {
  const sw = await request.get('/sw.js')
  expect(sw.status()).toBe(200)
  expect(sw.headers()['cache-control']).toBe('no-cache, no-store, must-revalidate')
  expect(sw.headers()['content-security-policy']).toBe("default-src 'self'; script-src 'self'; frame-ancestors 'none'")
  expect(sw.headers()['content-type']).toContain('javascript')

  const offline = await request.get('/offline.html')
  expect(offline.status()).toBe(200)
  expect(offline.headers()['x-frame-options']).toBe('DENY')
  expect(await offline.text()).toContain('Du bist offline')
})

test('Worker registriert sich, zeigt offline die Offline-Seite und speichert nur diese', async ({ page, context }) => {
  const user = await createAccount('CREATOR')
  await login(page, user.email)
  await page.goto('/admin')
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(scope).toBe(`${BASE_URL}/`)
  // Erst wenn der Worker die Seite kontrolliert, greift er bei Navigationen.
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  // Im Cache: ausschließlich die Offline-Seite - keine Admin-Seite, obwohl eben eine geladen wurde.
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) urls.push(new URL(request.url).pathname)
    return urls
  })
  expect(cached).toEqual(['/offline.html'])

  await context.setOffline(true)
  await page.goto('/admin/events')
  await expect(page.getByRole('heading', { name: 'Du bist offline' })).toBeVisible()
  await expect(page.getByText(user.email)).toHaveCount(0)
  await context.setOffline(false)

  // Positivkontrolle: wieder online lädt dieselbe Adresse die echte Seite.
  await page.goto('/admin/events')
  await expect(page.getByRole('heading', { name: 'Du bist offline' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/admin\/events$/)
})
