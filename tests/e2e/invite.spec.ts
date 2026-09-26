import { expect, test } from '@playwright/test'
import { createAccount, login, pageAlert, prisma, sha256, uniqueEmail } from './helpers'
import { REJECTED_DOMAIN, waitForMail } from './mail-server'

// Einladung und Passwort-Reset teilen sich denselben Einmal-Link (reset-password). Scheitert der
// Mailversand (hier: der Test-SMTP lehnt @nomail.test ab), zeigt /admin/users den Link dem
// einladenden Konto an - so lässt sich der Ablauf testen.

test('Einladung: Link nur als Hash gespeichert, GET verbraucht nichts, einmal nutzbar', async ({ page, browser }) => {
  const admin = await createAccount('ADMIN')
  await login(page, admin.email)
  await page.goto('/admin/users')

  const email = uniqueEmail('eingeladen', REJECTED_DOMAIN)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Rolle', { exact: true }).selectOption('MODERATOR')
  await page.getByRole('button', { name: 'Konto anlegen und einladen' }).click()
  await expect(page).toHaveURL(/created=link/)
  const link = await page.getByLabel('Einladungslink').inputValue()
  const token = new URL(link).searchParams.get('token')!
  expect(link).toContain('/reset-password?token=')

  const invited = await prisma.user.findUnique({ where: { email } })
  expect(invited?.role).toBe('MODERATOR')
  expect(invited?.passwordHash).toBeNull()
  expect(invited?.resetTokenHash).toBe(sha256(token))

  // Mail-Scanner rufen Links vorab auf: Ein GET darf den Link nicht verbrauchen.
  const guest = await browser.newPage()
  await guest.goto(link)
  await guest.goto(link)
  expect((await prisma.user.findUnique({ where: { email } }))?.resetTokenHash).toBe(sha256(token))

  // Zu schwaches Passwort wird serverseitig abgelehnt, der Link bleibt gültig.
  await guest.getByLabel('Neues Passwort').evaluate(el => el.removeAttribute('minlength'))
  await guest.getByLabel('Passwort wiederholen').evaluate(el => el.removeAttribute('minlength'))
  await guest.getByLabel('Neues Passwort').fill('kurz')
  await guest.getByLabel('Passwort wiederholen').fill('kurz')
  await guest.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(guest).toHaveURL(/error=weak/)

  await guest.getByLabel('Neues Passwort').fill('mein eigenes Passwort')
  await guest.getByLabel('Passwort wiederholen').fill('mein eigenes Passwort')
  await guest.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(guest).toHaveURL(/\/login\?reset=1/)
  expect((await prisma.user.findUnique({ where: { email } }))?.resetTokenHash).toBeNull()

  await login(guest, email, 'mein eigenes Passwort')
  await expect(guest).toHaveURL(/\/admin$/)

  // Zweite Nutzung desselben Links
  await guest.goto(link)
  await expect(pageAlert(guest)).toContainText('ungültig oder abgelaufen')
})

test('abgelaufener Link wird abgelehnt', async ({ page }) => {
  const user = await createAccount('CREATOR', { password: null })
  await prisma.user.update({
    where: { id: user.id },
    data: { resetTokenHash: sha256('abgelaufener-token'), resetTokenExpiresAt: new Date(Date.now() - 1000) }
  })
  await page.goto('/reset-password?token=abgelaufener-token')
  await expect(pageAlert(page)).toContainText('ungültig oder abgelaufen')
})

test('Einladung per Mail, wenn der Versand klappt: kein Link auf dem Bildschirm, Link aus der Mail funktioniert', async ({ page, browser }) => {
  const admin = await createAccount('ADMIN')
  await login(page, admin.email)
  await page.goto('/admin/users')

  const email = uniqueEmail('per-mail')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Rolle', { exact: true }).selectOption('MODERATOR')
  await page.getByRole('button', { name: 'Konto anlegen und einladen' }).click()
  await expect(page).toHaveURL(/created=mailed/)
  await expect(page.getByLabel('Einladungslink')).toHaveCount(0)

  const mail = await waitForMail(email)
  expect(mail.subject).toContain('Einladung')
  const link = /https?:\/\/\S+reset-password\?token=[\w-]+&invite=1/.exec(mail.text ?? '')?.[0]
  expect(link).toBeTruthy()
  const guest = await browser.newPage()
  await guest.goto(link!)
  await guest.getByLabel('Neues Passwort').fill('mein eigenes Passwort')
  await guest.getByLabel('Passwort wiederholen').fill('mein eigenes Passwort')
  await guest.getByRole('button', { name: 'Passwort speichern' }).click()
  await expect(guest).not.toHaveURL(/reset-password/)
  expect((await prisma.user.findUnique({ where: { email } }))?.passwordHash).not.toBeNull()
})
