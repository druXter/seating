import { expect, test } from '@playwright/test'

// Prüft die Header-Regeln aus next.config.ts - insbesondere die Reihenfolge (spätere Regel
// gewinnt): sensible Bereiche müssen ihre strengeren Werte behalten.

const PUBLIC = ['/', '/impressum', '/datenschutz']
const PRIVATE = ['/login', '/forgot-password', '/reset-password', '/account', '/admin', '/admin/users']

async function headersOf(request: import('@playwright/test').APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 })
  return response.headers()
}

test('allgemeine Sicherheits-Header auf jeder Seite', async ({ request }) => {
  for (const path of [...PUBLIC, ...PRIVATE, '/gibt-es-nicht']) {
    const h = await headersOf(request, path)
    expect(h['x-content-type-options'], path).toBe('nosniff')
    expect(h['strict-transport-security'], path).toBe('max-age=31536000')
    expect(h['permissions-policy'], path).toContain('camera=()')
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(h['x-frame-options'], path).toBe('DENY')
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
