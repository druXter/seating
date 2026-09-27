import { expect, test, type Page } from '@playwright/test'
import { verifyLoginAssertion, type DiscoveryDocument } from 'suite-kit'
import { BASE_URL, createAccount, login, PASSWORD, prisma, uniqueEmail } from './helpers'
import {
  clearCallback, lastCallbackOf, lastRedirectOf, setIdentity, SUITE_TOOLS, testSigner, TEST_SEATING_SIGNING_KEY,
  type TestIdentity, type ToolName
} from './suite-server'

// Konto-Föderation über suite-kit (Phase 8, docs/KONZEPT.md Abschnitt 10). Die anderen Tools spielt
// tests/e2e/suite-server.ts: Tool A (autoProvision) und Tool B (ohne) als Anbieter, Tool A zugleich
// als Empfänger von Seating-Anmeldungen.

const SEATING = new URL(BASE_URL).origin
let counter = 0
const uniqueSub = () => `konto-${Date.now().toString(36)}-${++counter}`

function identity(overrides: Partial<TestIdentity> = {}): TestIdentity {
  return { sub: uniqueSub(), email: uniqueEmail('suite'), name: 'Föderierte Person', role: 'CREATOR', ...overrides }
}

/** Klickt auf der Login-Seite "Mit Tool … anmelden" und wartet auf das Ergebnis des Rücksprungs. */
async function federatedLogin(page: Page, tool: ToolName) {
  await page.goto('/login')
  await page.getByRole('link', { name: `Mit ${SUITE_TOOLS[tool].label} anmelden` }).click()
  await page.waitForURL(url => url.origin === SEATING && !url.pathname.startsWith('/api/suite'))
}

async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto('/account')
  return new URL(page.url()).pathname === '/account'
}

test.afterEach(() => {
  setIdentity('a', null)
  setIdentity('b', null)
})

test.describe('Seating als Empfänger', () => {
  test('Login-Seite zeigt die konfigurierten Tools', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('link', { name: 'Mit Tool A anmelden' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mit Tool B anmelden' })).toBeVisible()
  })

  test('erster Login legt ein Konto an (Admin dort wird hier Creator), der nächste nutzt es wieder', async ({ page, browser }) => {
    const person = identity({ role: 'ADMIN' })
    setIdentity('a', person)

    await federatedLogin(page, 'a')
    expect(new URL(page.url()).pathname).toBe('/admin')
    const user = await prisma.user.findUniqueOrThrow({ where: { email: person.email }, include: { identities: true } })
    expect(user.role).toBe('CREATOR')
    expect(user.passwordHash).toBeNull()
    expect(user.name).toBe('Föderierte Person')
    expect(user.identities.map(i => [i.issuer, i.subject])).toEqual([[SUITE_TOOLS.a.origin, person.sub]])

    await page.goto('/account')
    await expect(page.getByText('Tool A', { exact: true })).toBeVisible()
    // Kein Passwort hier - also auch kein Formular zum Ändern.
    await expect(page.getByRole('heading', { name: 'Passwort ändern' })).toHaveCount(0)

    // Zweiter Login in einem anderen Browser: dasselbe Konto; die beim Anbieter geänderte Adresse
    // wird bei einem rein föderierten Konto nachgezogen.
    const changed = uniqueEmail('geaendert')
    setIdentity('a', { ...person, email: changed })
    const other = await browser.newContext()
    const second = await other.newPage()
    await federatedLogin(second, 'a')
    expect(new URL(second.url()).pathname).toBe('/admin')
    await other.close()
    expect(await prisma.user.count({ where: { identities: { some: { subject: person.sub } } } })).toBe(1)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(changed)
  })

  test('mapAdminRole aus: Moderator bleibt Moderator', async ({ page }) => {
    const person = identity({ role: 'MODERATOR' })
    setIdentity('a', person)
    await federatedLogin(page, 'a')
    expect((await prisma.user.findUniqueOrThrow({ where: { email: person.email } })).role).toBe('MODERATOR')
  })

  test('ohne autoProvision (Tool B) entsteht kein Konto', async ({ page }) => {
    const person = identity()
    setIdentity('b', person)
    await federatedLogin(page, 'b')
    expect(page.url()).toContain('/login?error=not-linked')
    await expect(page.getByText('Dieses Konto ist hier noch nicht bekannt')).toBeVisible()
    expect(await prisma.user.count({ where: { email: person.email } })).toBe(0)
    expect(await isLoggedIn(page)).toBe(false)
  })

  test('kein Zusammenführen über die E-Mail: vorhandenes lokales Konto -> email-taken', async ({ page }) => {
    const local = await createAccount('CREATOR')
    setIdentity('a', identity({ email: local.email }))
    await federatedLogin(page, 'a')
    expect(page.url()).toContain('/login?error=email-taken')
    await expect(page.getByText('Zu dieser E-Mail-Adresse gibt es hier bereits ein Konto')).toBeVisible()
    expect(await prisma.externalIdentity.count({ where: { userId: local.id } })).toBe(0)
    expect(await isLoggedIn(page)).toBe(false)
  })

  test('bewusst verknüpfen aus "Mein Konto", danach Login über das andere Tool; fremdes Konto -> linked-other', async ({ page, browser }) => {
    const local = await createAccount('CREATOR')
    const person = identity({ email: uniqueEmail('anders') })
    setIdentity('b', person)

    await login(page, local.email)
    await page.goto('/account')
    await page.getByRole('link', { name: 'Mit Tool B verknüpfen' }).click()
    await page.waitForURL(url => url.origin === SEATING && url.pathname === '/account' && url.searchParams.has('linked'))
    await expect(page.getByText('Konto verknüpft.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mit Tool B verknüpfen' })).toHaveCount(0)
    expect(await prisma.externalIdentity.count({ where: { userId: local.id, issuer: SUITE_TOOLS.b.origin, subject: person.sub } })).toBe(1)

    // Tool B legt keine Konten an - mit der Verknüpfung geht der Login trotzdem, und zwar ins lokale Konto.
    const fresh = await browser.newContext()
    const page2 = await fresh.newPage()
    await federatedLogin(page2, 'b')
    expect(new URL(page2.url()).pathname).toBe('/admin')
    await page2.goto('/account')
    await expect(page2.getByRole('main').getByText(local.email)).toBeVisible()
    await fresh.close()

    // Ein zweites lokales Konto kann dieselbe Identität nicht an sich ziehen.
    const second = await createAccount('CREATOR')
    const other = await browser.newContext()
    const page3 = await other.newPage()
    await login(page3, second.email)
    await page3.goto('/account')
    await page3.getByRole('link', { name: 'Mit Tool B verknüpfen' }).click()
    await page3.waitForURL(url => url.origin === SEATING && url.searchParams.get('error') === 'linked-other')
    expect(new URL(page3.url()).pathname).toBe('/account')
    await expect(page3.getByText('bereits mit einem anderen Konto hier verknüpft')).toBeVisible()
    expect(await prisma.externalIdentity.count({ where: { userId: second.id } })).toBe(0)
    await other.close()
  })

  test('Verknüpfung entfernen: nie die letzte Anmeldemöglichkeit, mit Passwort schon', async ({ page, browser }) => {
    // Rein föderiertes Konto: die einzige Verknüpfung bleibt.
    const person = identity()
    setIdentity('a', person)
    await federatedLogin(page, 'a')
    await page.goto('/account')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Entfernen' }).click()
    await page.waitForURL(/error=lastlogin/)
    await expect(page.getByText('Das ist deine einzige Anmeldemöglichkeit')).toBeVisible()
    expect(await prisma.externalIdentity.count({ where: { subject: person.sub } })).toBe(1)

    // Positivkontrolle: Konto mit Passwort darf die Verknüpfung entfernen.
    const local = await createAccount('CREATOR')
    await prisma.externalIdentity.create({ data: { issuer: SUITE_TOOLS.a.origin, subject: uniqueSub(), userId: local.id } })
    const context = await browser.newContext()
    const page2 = await context.newPage()
    await login(page2, local.email)
    await page2.goto('/account')
    page2.once('dialog', dialog => dialog.accept())
    await page2.getByRole('button', { name: 'Entfernen' }).click()
    await page2.waitForURL(/unlinked=1/)
    expect(await prisma.externalIdentity.count({ where: { userId: local.id } })).toBe(0)
    await context.close()
  })

  test('fremde Verknüpfung lässt sich nicht per gefälschtem Formular entfernen', async ({ page }) => {
    const victim = await createAccount('CREATOR')
    const foreign = await prisma.externalIdentity.create({ data: { issuer: SUITE_TOOLS.a.origin, subject: uniqueSub(), userId: victim.id } })
    const own = await createAccount('CREATOR')
    const mine = await prisma.externalIdentity.create({ data: { issuer: SUITE_TOOLS.a.origin, subject: uniqueSub(), userId: own.id } })

    await login(page, own.email)
    await page.goto('/account')
    // Formular frisch aus der Seite, nur die id ausgetauscht.
    await page.locator('input[name="identityId"]').evaluate((input, id) => { (input as HTMLInputElement).value = id }, foreign.id)
    page.once('dialog', dialog => dialog.accept())
    await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Entfernen' }).click()
    ])
    expect(await prisma.externalIdentity.count({ where: { id: foreign.id } })).toBe(1)
    expect(await prisma.externalIdentity.count({ where: { id: mine.id } })).toBe(1)

    // Positivkontrolle: dasselbe Formular mit der eigenen id wirkt.
    await page.goto('/account')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Entfernen' }).click()
    await page.waitForURL(/unlinked=1/)
    expect(await prisma.externalIdentity.count({ where: { id: mine.id } })).toBe(0)
  })

  test('Bestätigung nur einmal und nur in diesem Browser nutzbar', async ({ page, browser }) => {
    const person = identity()
    setIdentity('a', person)
    await federatedLogin(page, 'a')
    const replay = lastRedirectOf('a')!
    expect(replay).toContain('/api/suite/callback?assertion=')

    // Gleicher Browser ohne die neue Sitzung: das state-Cookie hat der erste Rücksprung schon gelöscht.
    expect((await page.context().cookies()).some(c => c.name.includes('suite-state'))).toBe(false)
    await page.context().clearCookies()
    await page.goto(replay)
    expect(page.url()).toContain('/login?error=sso')
    expect(await isLoggedIn(page)).toBe(false)

    // Fremder Browser mit der abgegriffenen Adresse.
    const context = await browser.newContext()
    const thief = await context.newPage()
    await thief.goto(replay)
    expect(thief.url()).toContain('/login?error=sso')
    expect(await isLoggedIn(thief)).toBe(false)
    await context.close()
  })

  for (const tamper of ['signature', 'audience', 'nonce', 'unknown-key', 'issuer'] as const) {
    test(`manipulierte Bestätigung (${tamper}) wird abgelehnt`, async ({ page }) => {
      const person = identity({ tamper })
      setIdentity('a', person)
      await federatedLogin(page, 'a')
      expect(page.url()).toContain('/login?error=sso')
      await expect(page.getByText('Die Anmeldung über das andere Tool ist fehlgeschlagen')).toBeVisible()
      expect(await prisma.user.count({ where: { email: person.email } })).toBe(0)
      expect(await isLoggedIn(page)).toBe(false)
    })
  }

  test('nur konfigurierte Anbieter: fremder Origin im Parameter wird nicht angesprochen', async ({ request }) => {
    for (const idp of ['http://localhost:2599', 'https://evil.example', '', 'javascript:alert(1)']) {
      const response = await request.get(`/api/suite/login?idp=${encodeURIComponent(idp)}`, { maxRedirects: 0 })
      expect(response.status(), idp).toBe(303)
      expect(response.headers().location, idp).toBe(`${SEATING}/login?error=sso`)
      expect(response.headers()['set-cookie'] ?? '', idp).not.toContain('suite-state')
    }
    // Positivkontrolle: konfigurierter Anbieter -> Weiterleitung dorthin samt state-Cookie.
    const ok = await request.get(`/api/suite/login?idp=${encodeURIComponent(SUITE_TOOLS.a.origin)}`, { maxRedirects: 0 })
    expect(ok.status()).toBe(303)
    expect(ok.headers().location).toMatch(new RegExp(`^${SUITE_TOOLS.a.origin}/api/suite/authorize\\?app=`))
    expect(ok.headers()['set-cookie']).toContain('suite-state')
  })

  test('Kontoverwaltung zeigt, über welches Tool sich ein Konto anmeldet', async ({ page, browser }) => {
    const person = identity({ name: 'Über Tool A' })
    setIdentity('a', person)
    const probe = await browser.newContext()
    await federatedLogin(await probe.newPage(), 'a')
    await probe.close()

    const admin = await createAccount('ADMIN')
    await login(page, admin.email)
    await page.goto('/admin/users')
    await expect(page.getByRole('listitem').filter({ hasText: person.email })).toContainText('Anmeldung über Tool A')
  })
})

test.describe('Seating als Anbieter', () => {
  const state = () => `${'s'.repeat(20)}${Date.now().toString(36)}${++counter}`.padEnd(43, 'x')

  test('Discovery nennt Seating mit dem öffentlichen Schlüssel', async ({ request }) => {
    const response = await request.get('/.well-known/suite-identity')
    expect(response.status()).toBe(200)
    const doc = await response.json() as DiscoveryDocument
    expect(doc.issuer).toBe(SEATING)
    expect(doc.name).toBe('Seating Test')
    expect(doc.authorizeUrl).toBe(`${SEATING}/api/suite/authorize`)
    expect(doc.keys.map(k => k.publicKey)).toEqual([testSigner('seating').publicKey])
    // Nur der öffentliche Teil.
    expect(JSON.stringify(doc)).not.toContain(TEST_SEATING_SIGNING_KEY)
  })

  test('nicht freigegebenes Tool bekommt keine Weiterleitung', async ({ request }) => {
    for (const app of [SUITE_TOOLS.b.origin, 'https://evil.example']) {
      const response = await request.get(`/api/suite/authorize?app=${encodeURIComponent(app)}&state=${state()}`, { maxRedirects: 0 })
      expect(response.status(), app).toBe(303)
      expect(response.headers().location, app).toBe(`${SEATING}/login?error=app`)
    }
  })

  test('Login bei Seating, dann weiter zum anfragenden Tool mit gültiger Bestätigung', async ({ page, request }) => {
    const user = await createAccount('ADMIN')
    clearCallback('a')
    const s = state()
    await page.goto(`/api/suite/authorize?app=${encodeURIComponent(SUITE_TOOLS.a.origin)}&state=${s}`)
    expect(new URL(page.url()).pathname).toBe('/login')

    await page.getByLabel('E-Mail').fill(user.email)
    await page.getByLabel('Passwort').fill(PASSWORD)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    // Über die Zwischenseite /login/continue mit echtem Seitenwechsel zu Tool A.
    await page.waitForURL(url => url.origin === SUITE_TOOLS.a.origin)
    await expect(page.getByText('Bestätigung empfangen.')).toBeVisible()

    const received = lastCallbackOf('a')!
    expect(received.state).toBe(s)
    const discovery = await (await request.get('/.well-known/suite-identity')).json() as DiscoveryDocument
    const result = verifyLoginAssertion(received.assertion, { issuer: SEATING, audience: SUITE_TOOLS.a.origin, nonce: s, keys: discovery.keys })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.claims.sub).toBe(user.id)
    expect(result.claims.email).toBe(user.email)
    expect(result.claims.role).toBe('ADMIN')

    // Schon eingeloggt: ohne Rückfrage direkt weiter.
    clearCallback('a')
    const s2 = state()
    await page.goto(`${SEATING}/api/suite/authorize?app=${encodeURIComponent(SUITE_TOOLS.a.origin)}&state=${s2}`)
    await page.waitForURL(url => url.origin === SUITE_TOOLS.a.origin)
    expect(lastCallbackOf('a')!.state).toBe(s2)
  })

  test('keine Ketten: rein föderiertes Konto bekommt keine Bestätigung', async ({ page }) => {
    setIdentity('a', identity())
    await federatedLogin(page, 'a')
    clearCallback('a')
    await page.goto(`/api/suite/authorize?app=${encodeURIComponent(SUITE_TOOLS.a.origin)}&state=${state()}`)
    expect(page.url()).toBe(`${SEATING}/account?error=nochain`)
    await expect(page.getByText('kann deshalb keine Anmeldung für weitere Tools bestätigen')).toBeVisible()
    expect(lastCallbackOf('a')).toBeNull()
  })

  test('Zwischenseite leitet nur zum eigenen Anbieter-Endpunkt weiter', async ({ page }) => {
    // Fremdes Ziel: Die Seite leitet sofort in den eigenen Admin-Bereich (ohne Sitzung weiter zum Login).
    await page.goto(`/login/continue?to=${encodeURIComponent('https://evil.example/api/suite/authorize?x')}`)
    await page.waitForURL(url => url.origin === SEATING && url.pathname === '/login')
    expect(new URL(page.url()).searchParams.get('next')).toBe('/admin')
  })
})
