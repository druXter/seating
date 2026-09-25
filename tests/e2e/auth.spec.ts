import { expect, test } from '@playwright/test'
import { BASE_URL, PASSWORD, createAccount, login, pageAlert, prisma, sha256, uniqueEmail } from './helpers'

const SESSION_COOKIE = '__Host-session'

async function sessionCookie(context: import('@playwright/test').BrowserContext) {
  return (await context.cookies()).find(c => c.name === SESSION_COOKIE)
}

test('geschützte Seiten leiten ohne Sitzung zur Anmeldung und danach zurück', async ({ page }) => {
  const user = await createAccount('CREATOR')
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/)
  await page.getByLabel('E-Mail').fill(user.email)
  await page.getByLabel('Passwort').fill(PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'Mein Konto' })).toBeVisible()
})

test('Session-Cookie: __Host-, HttpOnly, Secure, SameSite=Lax; in der Datenbank nur der Hash', async ({ page, context }) => {
  const user = await createAccount('CREATOR')
  await login(page, user.email)
  await expect(page).toHaveURL(/\/admin$/)

  const cookie = await sessionCookie(context)
  expect(cookie).toBeDefined()
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/', domain: '127.0.0.1' })

  const sessions = await prisma.session.findMany({ where: { userId: user.id } })
  expect(sessions).toHaveLength(1)
  expect(sessions[0].tokenHash).toBe(sha256(cookie!.value))
  expect(sessions[0].tokenHash).not.toBe(cookie!.value)
})

test('Login erzeugt immer eine neue Sitzung (Session-Fixation)', async ({ page, context }) => {
  const user = await createAccount('CREATOR')
  await context.addCookies([
    { name: SESSION_COOKIE, value: 'vom-angreifer-gesetzt', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }
  ])
  await login(page, user.email)
  await expect(page).toHaveURL(/\/admin$/)
  expect((await sessionCookie(context))?.value).not.toBe('vom-angreifer-gesetzt')
})

test('Abmelden löscht die Sitzung auch in der Datenbank', async ({ page }) => {
  const user = await createAccount('CREATOR')
  await login(page, user.email)
  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect(page).toHaveURL(`${BASE_URL}/`)
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login/)
})

test('kein Open Redirect über next', async ({ page }) => {
  for (const next of ['//evil.example/', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
    const user = await createAccount('CREATOR')
    await page.context().clearCookies()
    await page.goto(`/login?next=${encodeURIComponent(next)}`)
    await page.getByLabel('E-Mail').fill(user.email)
    await page.getByLabel('Passwort').fill(PASSWORD)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await expect(page, next).toHaveURL(`${BASE_URL}/admin`)
  }
})

test('gleiche Fehlermeldung und vergleichbare Antwortzeit für bekannte und unbekannte Adressen', async ({ page }) => {
  const user = await createAccount('CREATOR')
  const unknown = uniqueEmail('unbekannt')

  async function failedLogin(email: string): Promise<{ ms: number; text: string }> {
    const start = Date.now()
    await login(page, email, 'falsches Passwort!')
    await expect(page).toHaveURL(/error=1/)
    const ms = Date.now() - start
    return { ms, text: await pageAlert(page).innerText() }
  }

  // Aufwärmen (erster Aufruf erzeugt den Wegwerf-Hash).
  await failedLogin(uniqueEmail('warmup'))

  const known: number[] = []
  const unknownTimes: number[] = []
  for (let i = 0; i < 3; i++) {
    const a = await failedLogin(user.email)
    const b = await failedLogin(unknown)
    expect(a.text).toBe('E-Mail oder Passwort ist falsch.')
    expect(b.text).toBe(a.text)
    known.push(a.ms)
    unknownTimes.push(b.ms)
  }
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  // Unbekannte Adressen rechnen ebenfalls einen scrypt-Hash - sie dürfen nicht deutlich schneller sein.
  expect(avg(unknownTimes)).toBeGreaterThan(avg(known) * 0.6)
})

test('Passwortwechsel beendet andere Sitzungen, die eigene bleibt', async ({ browser }) => {
  const user = await createAccount('CREATOR')
  const deviceA = await browser.newPage()
  const deviceB = await browser.newPage()
  await login(deviceA, user.email)
  await login(deviceB, user.email)
  await expect(deviceA).toHaveURL(/\/admin$/)
  await expect(deviceB).toHaveURL(/\/admin$/)

  await deviceA.goto('/account')
  await deviceA.getByLabel('Aktuelles Passwort').fill(PASSWORD)
  await deviceA.getByLabel('Neues Passwort', { exact: true }).fill('ein neues sicheres Passwort')
  await deviceA.getByLabel('Neues Passwort wiederholen').fill('ein neues sicheres Passwort')
  await deviceA.getByRole('button', { name: 'Passwort ändern' }).click()
  await expect(deviceA).toHaveURL(/passwordChanged=1/)

  await deviceA.goto('/admin')
  await expect(deviceA).toHaveURL(/\/admin$/)
  await deviceB.goto('/admin')
  await expect(deviceB).toHaveURL(/\/login/)
})

test('Passwortwechsel verlangt das aktuelle Passwort und die Passwort-Regel', async ({ page }) => {
  const user = await createAccount('CREATOR')
  await login(page, user.email)
  await page.goto('/account')
  await page.getByLabel('Aktuelles Passwort').fill('falsch falsch falsch')
  await page.getByLabel('Neues Passwort', { exact: true }).fill('ein neues sicheres Passwort')
  await page.getByLabel('Neues Passwort wiederholen').fill('ein neues sicheres Passwort')
  await page.getByRole('button', { name: 'Passwort ändern' }).click()
  await expect(page).toHaveURL(/error=wrongpassword/)

  // Serverseitige Regel greift auch, wenn das Browser-minLength umgangen wird.
  await page.getByLabel('Aktuelles Passwort').fill(PASSWORD)
  await page.getByLabel('Neues Passwort', { exact: true }).evaluate(el => el.removeAttribute('minlength'))
  await page.getByLabel('Neues Passwort wiederholen').evaluate(el => el.removeAttribute('minlength'))
  await page.getByLabel('Neues Passwort', { exact: true }).fill('kurz')
  await page.getByLabel('Neues Passwort wiederholen').fill('kurz')
  await page.getByRole('button', { name: 'Passwort ändern' }).click()
  await expect(page).toHaveURL(/error=weak/)
})
