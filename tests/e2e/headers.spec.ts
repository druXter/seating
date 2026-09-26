import { expect, test } from '@playwright/test'
import { createAccount, createEventRecord, uniqueSlug } from './helpers'

// Prüft die Header-Regeln aus next.config.ts - insbesondere die Reihenfolge (spätere Regel
// gewinnt): sensible Bereiche müssen ihre strengeren Werte behalten.

const PUBLIC = ['/', '/impressum', '/datenschutz']
const PRIVATE = ['/login', '/forgot-password', '/reset-password', '/account', '/admin', '/admin/users']

async function headersOf(request: import('@playwright/test').APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 })
  return response.headers()
}

test('allgemeine Sicherheits-Header auf jeder Seite', async ({ request }) => {
  for (const path of [...PUBLIC, ...PRIVATE, '/gibt-es-nicht', '/admin/events', '/b/x/y']) {
    const h = await headersOf(request, path)
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['strict-transport-security'], path).toBe('max-age=31536000')
    expect(h['permissions-policy'], path).toContain('camera=()')
  }
})

test('kein Einbetten außer auf Eventseiten - auch nicht für einteilige Seiten des Tools', async ({ request }) => {
  for (const path of [...PUBLIC, ...PRIVATE, '/admin/events', '/admin/events/new', '/b/x/y', '/api/cron/cleanup']) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(h['x-frame-options'], path).toBe('DENY')
  }
})

test('öffentliche Eventseiten sind einbettbar (wie in rsvp-app), aber nicht indexiert', async ({ request }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { slug: uniqueSlug('einbettbar'), status: 'OPEN' })
  const response = await request.get(`/${event.slug}`)
  expect(response.status()).toBe(200)
  const h = response.headers()
  expect(h['content-security-policy']).toBe('frame-ancestors *')
  // X-Frame-Options kennt kein "erlaubt" - er darf hier gar nicht erst gesetzt sein.
  expect(h['x-frame-options']).toBeUndefined()
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(await response.text()).toContain('<meta name="robots" content="noindex, nofollow"/>')
})

test('Hintergrundbilder: Sandbox-CSP auf allen drei Pfaden', async ({ request }) => {
  for (const path of ['/admin/plans/x/background', '/admin/events/x/background', `/${uniqueSlug()}/background`]) {
    const h = await headersOf(request, path)
    expect(h['content-security-policy'], path).toBe("default-src 'none'; sandbox; frame-ancestors 'none'")
  }
})

test('öffentliche Seiten: normale Referrer-Policy, indexierbar', async ({ request }) => {
  for (const path of PUBLIC) {
    const h = await headersOf(request, path)
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    expect(h['x-robots-tag'], path).toBeUndefined()
  }
})

test('sensible Seiten: noindex, kein Caching, kein Einbetten', async ({ request }) => {
  // Auch die Weiterleitung ohne Sitzung (/admin -> /login) trägt die Header.
  for (const path of PRIVATE) {
    const h = await headersOf(request, path)
    expect(h['x-robots-tag'], path).toBe('noindex, nofollow')
    expect(h['cache-control'], path).toContain('no-store')
    expect(h['content-security-policy'], path).toBe("frame-ancestors 'none'")
  }
})

test('Einmal-Links und Verwaltungslinks gehen nicht per Referer weiter', async ({ request }) => {
  for (const path of ['/reset-password?token=abc', '/b/irgendwas/token']) {
    const h = await headersOf(request, path)
    expect(h['referrer-policy'], path).toBe('no-referrer')
    expect(h['x-robots-tag'], path).toBe('noindex, nofollow')
  }
})

test('Föderations-Pfade: Referrer-Policy überschreibt die allgemeine Regel', async ({ request }) => {
  const h = await headersOf(request, '/api/suite/authorize')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['x-content-type-options']).toBe('nosniff')
})
