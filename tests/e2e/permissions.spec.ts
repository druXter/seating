import { expect, test, type Page } from '@playwright/test'
import { createAccount, locationOf, login, prisma, readForm, submitForm, uniqueEmail } from './helpers'

// Berechtigungen werden in JEDER Server Action geprüft, nicht nur auf der Seite. Jeder
// Angriffsfall hat eine Positivkontrolle: Derselbe POST wirkt, wenn ihn ein berechtigtes Konto
// schickt - sonst würde ein kaputtes Formular einen Schutz nur vortäuschen.

async function usersPageForms(page: Page) {
  // Das Rollen-Formular gibt es nur für änderbare (Nicht-Admin-)Konten - eins sicherstellen,
  // damit der Test auch einzeln läuft.
  await createAccount('CREATOR')
  await page.goto('/admin/users')
  const create = await readForm(page, 'form:has(input[name="email"])')
  const role = await readForm(page, 'form:has(select[name="role"][aria-label])')
  return { create, role }
}

test('Konto anlegen: ohne Sitzung wirkungslos, als Admin wirksam', async ({ page, browser }) => {
  const admin = await createAccount('ADMIN')
  await login(page, admin.email)
  const { create } = await usersPageForms(page)

  const anonymous = await browser.newPage()
  const victimEmail = uniqueEmail('angriff')
  const denied = await submitForm(anonymous, create, { email: victimEmail, role: 'ADMIN' })
  expect(locationOf(denied)?.pathname).toBe('/login')
  expect(await prisma.user.findUnique({ where: { email: victimEmail } })).toBeNull()

  // Positivkontrolle
  const allowed = await submitForm(page, create, { email: victimEmail, role: 'CREATOR' })
  expect(locationOf(allowed)?.pathname).toBe('/admin/users')
  expect((await prisma.user.findUnique({ where: { email: victimEmail } }))?.role).toBe('CREATOR')
})

test('Creator kann nur Moderator*innen anlegen, auch mit manipulierter Rolle', async ({ page, browser }) => {
  const admin = await createAccount('ADMIN')
  await login(page, admin.email)
  const { create } = await usersPageForms(page)

  const creator = await createAccount('CREATOR')
  const creatorPage = await browser.newPage()
  await login(creatorPage, creator.email)
  await expect(creatorPage).toHaveURL(/\/admin$/)

  const email = uniqueEmail('eskalation')
  await submitForm(creatorPage, create, { email, role: 'ADMIN' })
  expect((await prisma.user.findUnique({ where: { email } }))?.role).toBe('MODERATOR')
})

test('Moderator*in: kein Zugriff auf Kontoverwaltung, Seite und Aktion', async ({ page, browser }) => {
  const admin = await createAccount('ADMIN')
  await login(page, admin.email)
  const moderator = await createAccount('MODERATOR')
  const target = await createAccount('CREATOR')
  const { create, role } = await usersPageForms(page)

  const modPage = await browser.newPage()
  await login(modPage, moderator.email)
  await modPage.goto('/admin/users')
  await expect(modPage).toHaveURL(/\/account$/)

  const email = uniqueEmail('mod')
  await submitForm(modPage, create, { email })
  expect(await prisma.user.findUnique({ where: { email } })).toBeNull()

  await submitForm(modPage, role, { userId: target.id, role: 'ADMIN' })
  expect((await prisma.user.findUnique({ where: { id: target.id } }))?.role).toBe('CREATOR')

  // Positivkontrolle: dieselbe Rollenänderung als Admin wirkt.
  await submitForm(page, role, { userId: target.id, role: 'MODERATOR' })
  expect((await prisma.user.findUnique({ where: { id: target.id } }))?.role).toBe('MODERATOR')
})

test('Admin-Konten lassen sich in der Oberfläche weder herabstufen noch löschen', async ({ page }) => {
  const admin = await createAccount('ADMIN')
  const otherAdmin = await createAccount('ADMIN')
  await createAccount('CREATOR')
  await login(page, admin.email)
  const { role } = await usersPageForms(page)

  await submitForm(page, role, { userId: otherAdmin.id, role: 'MODERATOR' })
  await submitForm(page, role, { userId: admin.id, role: 'MODERATOR' })
  expect((await prisma.user.findUnique({ where: { id: otherAdmin.id } }))?.role).toBe('ADMIN')
  expect((await prisma.user.findUnique({ where: { id: admin.id } }))?.role).toBe('ADMIN')

  await page.reload()
  const deleteForm = await readForm(page, 'form:has(button:text("Löschen"))')
  await submitForm(page, deleteForm, { userId: otherAdmin.id })
  expect(await prisma.user.findUnique({ where: { id: otherAdmin.id } })).not.toBeNull()

  // Positivkontrolle: ein Creator-Konto lässt sich löschen.
  const creator = await createAccount('CREATOR')
  await submitForm(page, deleteForm, { userId: creator.id })
  expect(await prisma.user.findUnique({ where: { id: creator.id } })).toBeNull()
})

test('CSRF: Server Action mit fremdem Origin wird abgelehnt', async ({ page }) => {
  const admin = await createAccount('ADMIN')
  await login(page, admin.email)
  const { create } = await usersPageForms(page)

  const email = uniqueEmail('csrf')
  const response = await submitForm(page, create, { email }, { origin: 'https://evil.example' })
  expect(response.status()).not.toBe(303)
  expect(await prisma.user.findUnique({ where: { email } })).toBeNull()

  // Positivkontrolle mit eigenem Origin
  await submitForm(page, create, { email })
  expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull()
})
