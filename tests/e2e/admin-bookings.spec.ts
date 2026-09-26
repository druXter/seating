import { expect, test, type Browser, type Page } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { manageToken } from '../../app/lib/booking-tokens'
import {
  cookieOf, createAccount, createBooking, createEventRecord, login, manageLinkOf, prisma, readForm, submitForm, tablesLayout, uniqueEmail, verifyLinkOf
} from './helpers'
import { mailsTo, waitForMail } from './mail-server'

// Buchungsverwaltung durch Veranstalter*innen (Phase 4): Liste, Ändern mit Mail alt -> neu, Storno,
// Löschen, Unbestätigte, Anlegen, Verwaltungslink, Rundmail, Export, Druckansicht, Berechtigungen.
// Jeder Angriffsfall mit Positivkontrolle.

async function ownedEvent(options: { capacities?: number[]; minFillRatio?: number | null } = {}) {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: tablesLayout(options.capacities ?? [8, 8, 6, 4]), minFillRatio: options.minFillRatio })
  return { owner, event }
}

function detailUrl(eventId: string, bookingId: string) {
  return `/admin/events/${eventId}/bookings/${bookingId}`
}

async function tableOfBooking(bookingId: string) {
  return (await prisma.allocation.findFirst({ where: { bookingId }, include: { unit: true } }))?.unit.key ?? null
}

async function strangerPage(browser: Browser): Promise<Page> {
  const stranger = await createAccount('CREATOR')
  const page = await (await browser.newContext()).newPage()
  await login(page, stranger.email)
  return page
}

test('Liste: Filter, Suche, Links im Plan, CSV mit Formel-Schutz; fremde Konten und Öffentlichkeit sehen nichts', async ({ page, browser }) => {
  const { owner, event } = await ownedEvent()
  const liese = await createBooking(event.id, ['t1'], { name: 'Lieselotte Beispiel', email: 'liese@example.test', partySize: 7, note: '=HYPERLINK("http://böse.test","klick")' })
  await createBooking(event.id, ['t2'], { status: 'PENDING', expiresAt: new Date(Date.now() + 10 * 60_000), name: 'Paula Wartend' })
  await createBooking(event.id, ['t3'], { status: 'PENDING', expiresAt: new Date(Date.now() - 60_000), name: 'Vera Verfallen' })
  await createBooking(event.id, [], { status: 'CANCELLED', name: 'Stefan Storniert' })

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  // Plan: belegter Tisch -> Buchung, freier (auch mit abgelaufenem Hold) -> anlegen.
  await expect(page.locator(`a[href="${detailUrl(event.id, liese.id)}"]`)).toHaveAttribute('aria-label', 'Tisch 1: Buchung von Lieselotte Beispiel')
  await expect(page.locator(`a[href="/admin/events/${event.id}/bookings/new?table=t3"]`)).toHaveCount(1)

  await page.goto(`/admin/events/${event.id}/bookings`)
  const table = page.getByRole('table')
  await expect(table).toContainText('Lieselotte Beispiel')
  await expect(table).toContainText('Paula Wartend')
  await expect(table).not.toContainText('Vera Verfallen')
  await expect(table).not.toContainText('Stefan Storniert')
  await expect(page.getByTestId('booking-counts')).toContainText('1 bestätigte Buchung mit 7 Personen')

  await page.getByLabel('Status').selectOption('expired')
  await page.getByRole('button', { name: 'Anzeigen' }).click()
  await expect(table).toContainText('Vera Verfallen')
  await expect(table).not.toContainText('Lieselotte')

  await page.goto(`/admin/events/${event.id}/bookings?status=all&q=LIESE`)
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2)
  await page.getByRole('link', { name: 'Lieselotte Beispiel' }).click()
  await expect(page).toHaveURL(new RegExp(`${detailUrl(event.id, liese.id)}$`))

  // CSV-Export (gleiche Filter wie die Liste).
  const exportPath = `/admin/events/${event.id}/export?status=active`
  const response = await page.request.get(exportPath, { headers: { cookie: await cookieOf(page) } })
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('text/csv; charset=utf-8')
  expect(response.headers()['content-disposition']).toBe(`attachment; filename="${event.slug}-buchungen.csv"`)
  const csv = (await response.body()).toString('utf8')
  expect(csv.startsWith('﻿Tisch;Name;E-Mail;')).toBe(true)
  expect(csv).toContain(`Tisch 1;Lieselotte Beispiel;liese@example.test;;7;bestätigt;online;"'=HYPERLINK(""http://böse.test"",""klick"")"`)
  expect(csv).toContain('Paula Wartend')
  expect(csv).not.toContain('Vera Verfallen')

  // Ohne Sitzung und mit fremdem Konto: 404, kein Inhalt.
  expect((await page.request.get(exportPath, { headers: { cookie: '' } })).status()).toBe(404)
  const stranger = await strangerPage(browser)
  const foreign = await stranger.request.get(exportPath, { headers: { cookie: await cookieOf(stranger) } })
  expect(foreign.status()).toBe(404)
  expect(await foreign.text()).not.toContain('Lieselotte')
  for (const path of [`/admin/events/${event.id}/bookings`, detailUrl(event.id, liese.id), `/admin/events/${event.id}/mail`, `/admin/events/${event.id}/print`]) {
    expect((await stranger.goto(path))?.status(), path).toBe(404)
  }

  const visitor = await browser.newPage()
  const html = await (await visitor.goto(`/${event.slug}`))!.text()
  expect(html).not.toContain('Lieselotte')
  expect(html).not.toContain('liese@')
})

test('Ändern: Mail mit alt → neu und SEQUENCE+1, belegter Tisch und zu viele Personen abgelehnt, Konflikt erkannt, ohne Mail', async ({ page }) => {
  const { owner, event } = await ownedEvent({ minFillRatio: 0.5 })
  const email = uniqueEmail('aendern')
  const booking = await createBooking(event.id, ['t1'], { email, partySize: 4, name: 'Max Muster' })
  await createBooking(event.id, ['t2'], { name: 'Andere Gruppe' })

  await login(page, owner.email)
  await page.goto(detailUrl(event.id, booking.id))
  const options = await page.getByLabel('Tisch', { exact: true }).locator('option').allTextContents()
  expect(options.some(o => o.startsWith('Tisch 2'))).toBe(false)
  expect(options.some(o => o.startsWith('Tisch 1') && o.includes('aktuell'))).toBe(true)

  const stale = await readForm(page, 'form:has(select[name="unitKey"])')
  // Belegten Tisch nachgespielt und zu viele Personen: abgelehnt, nichts geändert.
  expect(await (await submitForm(page, stale, { unitKey: 't2' })).text()).toContain('Tisch 2 ist belegt.')
  expect(await (await submitForm(page, stale, { partySize: '9' })).text()).toContain('Tisch 1 hat nur 8 Plätze')
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ partySize: 4, icsSequence: 0 })
  expect(await tableOfBooking(booking.id)).toBe('t1')

  // Positivkontrolle über die Oberfläche: Tischwechsel und Personenzahl unter der Mindestbelegung
  // (gilt für Veranstalter*innen nicht).
  await page.getByLabel('Tisch', { exact: true }).selectOption('t3')
  await page.getByLabel('Personen', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ partySize: 2, icsSequence: 1 })
  expect(await tableOfBooking(booking.id)).toBe('t3')

  const mail = await waitForMail(email)
  expect(mail.subject).toBe('Buchung geändert – Testevent')
  expect(mail.text).toContain('Geändert: Personenzahl, Tisch.')
  expect(mail.text).toContain('Personenzahl: 4 → 2')
  expect(mail.text).toContain('Tisch: Tisch 1 → Tisch 3')
  expect(mail.html).toContain('Die Veranstalter*innen haben deine Buchung geändert')
  expect(manageLinkOf(mail.text ?? '')).toContain(`/b/${booking.id}/`)
  expect(mail.attachments[0].content.toString()).toContain('SEQUENCE:1\r\n')

  const audit = await prisma.auditLog.findFirstOrThrow({ where: { bookingId: booking.id, action: 'changed' } })
  expect(audit).toMatchObject({ actor: owner.id, diff: { table: { from: 't1', to: 't3' }, partySize: { from: 4, to: 2 }, notified: true } })
  await expect(page.getByTestId('audit-log')).toContainText(`${owner.email}: geändert`)
  await expect(page.getByTestId('audit-log')).toContainText('Tisch: Tisch 1 → Tisch 3')
  await expect(page.getByTestId('mail-log')).toContainText(`Änderung (Veranstalter*in) an ${email} – verschickt`)

  // Das alte Formular baut auf einem veralteten Stand auf: nicht still überschreiben.
  expect(await (await submitForm(page, stale, { name: 'Überschrieben' })).text()).toContain('inzwischen geändert')
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).name).toBe('Max Muster')

  // Ohne Benachrichtigung: keine Mail; Name ändert die Kalender-Sequenz nicht.
  await page.goto(detailUrl(event.id, booking.id))
  await page.getByLabel('Name').fill('Max Mustermann')
  await page.getByLabel(/Kund\*in per Mail benachrichtigen \(mit/).uncheck()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ name: 'Max Mustermann', icsSequence: 1 })
  await page.waitForTimeout(500)
  expect(await mailsTo(email)).toHaveLength(1)
})

test('interne Notiz bleibt intern; Storno mit und ohne Mail; endgültig löschen ohne Personendaten im Verlauf', async ({ page, browser }) => {
  const { owner, event } = await ownedEvent()
  const email = uniqueEmail('storno')
  const booking = await createBooking(event.id, ['t1'], { email, name: 'Nora Notiz' })
  const quiet = uniqueEmail('leise')
  const quietBooking = await createBooking(event.id, ['t2'], { email: quiet })
  page.on('dialog', dialog => dialog.accept())

  await login(page, owner.email)
  await page.goto(detailUrl(event.id, booking.id))
  await page.getByLabel('Interne Notiz').fill('VIP-Gast, Sekt bereitstellen')
  await page.getByRole('button', { name: 'Notiz speichern' }).click()
  await expect(page.getByText('Interne Notiz gespeichert.')).toBeVisible()
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).adminNote).toBe('VIP-Gast, Sekt bereitstellen')

  const visitor = await browser.newPage()
  const manageHtml = await (await visitor.goto(`/b/${booking.id}/${manageToken(booking.id, 1)}`))!.text()
  expect(manageHtml).toContain('Nora Notiz')
  expect(manageHtml).not.toContain('VIP-Gast')
  expect(await (await visitor.goto(`/${event.slug}`))!.text()).not.toContain('VIP-Gast')

  await page.getByRole('button', { name: 'Buchung stornieren' }).click()
  await expect(page.getByText('Buchung storniert, der Tisch ist wieder frei.')).toBeVisible()
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: 'CANCELLED', icsSequence: 1 })
  expect(await tableOfBooking(booking.id)).toBeNull()
  const cancelMail = await waitForMail(email)
  expect(cancelMail.subject).toBe('Buchung storniert – Testevent')
  expect(cancelMail.text).toContain('Die Veranstalter*innen haben deine Buchung storniert')
  expect(cancelMail.attachments[0].content.toString()).toContain('METHOD:CANCEL\r\n')

  // Ohne Mail stornieren.
  await page.goto(detailUrl(event.id, quietBooking.id))
  await page.getByLabel(/Kund\*in per Mail benachrichtigen \(Kalendereintrag/).uncheck()
  await page.getByRole('button', { name: 'Buchung stornieren' }).click()
  await expect(page.getByText('Buchung storniert')).toBeVisible()
  await page.waitForTimeout(500)
  expect(await mailsTo(quiet)).toHaveLength(0)

  // Endgültig löschen: Buchung samt Protokollen weg, am Event nur ein Eintrag ohne Personendaten.
  await page.goto(detailUrl(event.id, booking.id))
  await page.getByRole('button', { name: 'Endgültig löschen' }).click()
  await expect(page).toHaveURL(new RegExp(`/admin/events/${event.id}/bookings\\?deleted=1`))
  await expect(page.getByText('Buchung endgültig gelöscht.')).toBeVisible()
  expect(await prisma.booking.count({ where: { id: booking.id } })).toBe(0)
  expect(await prisma.auditLog.count({ where: { bookingId: booking.id } })).toBe(0)
  expect(await prisma.mailLog.count({ where: { bookingId: booking.id } })).toBe(0)
  const trace = await prisma.auditLog.findFirstOrThrow({ where: { eventId: event.id, bookingId: null, action: 'deleted' } })
  expect(JSON.stringify(trace.diff)).not.toMatch(/Nora|storno-|VIP/)
  await expect(page.getByText('Verlauf: gelöschte Buchungen und Rundmails')).toBeVisible()
})

test('unbestätigt: erneut senden mit und ohne neue Frist, E-Mail korrigieren (alte Adresse bekommt nichts), manuell bestätigen', async ({ page }) => {
  const { owner, event } = await ownedEvent()
  const typo = uniqueEmail('tippfehler')
  const expiresAt = new Date(Date.now() + 10 * 60_000)
  const booking = await createBooking(event.id, ['t1'], { status: 'PENDING', expiresAt, email: typo })
  await login(page, owner.email)
  await page.goto(detailUrl(event.id, booking.id))
  const correctForm = await readForm(page, 'form:has(input[name="email"][type="email"])')

  // Erneut senden ohne neue Frist.
  await page.getByLabel(/^Frist neu beginnen \(/).uncheck()
  await page.getByRole('button', { name: 'Bestätigungsmail erneut senden' }).click()
  await expect(page.getByText('Neuer Bestätigungslink und Code verschickt.')).toBeVisible()
  const first = verifyLinkOf((await waitForMail(typo)).text ?? '')
  let stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  expect(stored.expiresAt!.getTime()).toBe(expiresAt.getTime())
  expect(stored.verifyAttempts).toBe(0)

  // Mit neuer Frist. Frisch laden: Der Hinweis unten stünde sonst schon vom ersten Senden da.
  await page.goto(detailUrl(event.id, booking.id))
  await page.getByRole('button', { name: 'Bestätigungsmail erneut senden' }).click()
  await expect(page.getByText('Neuer Bestätigungslink und Code verschickt.')).toBeVisible()
  const second = verifyLinkOf((await waitForMail(typo, 2)).text ?? '')
  expect(second.token).not.toBe(first.token)
  stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  expect(stored.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000)

  // Adresse korrigieren: neue bekommt Link/Code, alte nichts mehr.
  await page.goto(detailUrl(event.id, booking.id))
  const fixed = uniqueEmail('richtig')
  await page.getByLabel('E-Mail-Adresse korrigieren').fill(fixed)
  await page.getByRole('button', { name: 'Korrigieren und Bestätigungsmail schicken' }).click()
  await expect(page.getByText('E-Mail-Adresse korrigiert, die Bestätigungsmail')).toBeVisible()
  const third = verifyLinkOf((await waitForMail(fixed)).text ?? '')
  expect(third.bookingId).toBe(booking.id)
  await page.waitForTimeout(500)
  expect(await mailsTo(typo)).toHaveLength(2)
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ email: fixed, status: 'PENDING' })
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { bookingId: booking.id, action: 'email-corrected' } })
  expect(audit.diff).toMatchObject({ email: { from: typo, to: fixed }, renewedExpiry: true })

  // Manuell bestätigen: Bestätigungsmail mit Verwaltungslink, Adresse gilt nicht als von der Person bestätigt.
  await page.getByRole('button', { name: 'Manuell bestätigen' }).click()
  await expect(page.getByText('Buchung bestätigt.')).toBeVisible()
  const confirmed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  expect(confirmed).toMatchObject({ status: 'CONFIRMED', emailVerifiedAt: null, verifyTokenHash: null, verifyCodeHmac: null, expiresAt: null })
  const confirmation = await waitForMail(fixed, 2)
  expect(confirmation.subject).toBe('Buchung bestätigt – Testevent')
  expect((await page.goto(manageLinkOf(confirmation.text ?? '')))?.status()).toBe(200)

  // Bestätigte Adressen sind nicht änderbar - auch nicht per nachgespieltem Formular.
  await page.goto(detailUrl(event.id, booking.id))
  const result = await submitForm(page, correctForm, { email: uniqueEmail('spaeter') })
  expect(await result.text()).toContain('Nur bei unbestätigten Buchungen')
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).email).toBe(fixed)
})

test('Buchung anlegen: ohne E-Mail, direkt bestätigt mit Mail, mit Bestätigung per Mail; eine pro Adresse; belegter Tisch', async ({ page }) => {
  const { owner, event } = await ownedEvent()
  await createBooking(event.id, ['t1'], { name: 'Schon da' })
  await login(page, owner.email)

  // Vorauswahl aus dem Plan.
  await page.goto(`/admin/events/${event.id}/bookings/new?table=t4`)
  await expect(page.getByLabel('Tisch')).toHaveValue('t4')
  const form = await readForm(page, 'form:has(select[name="unitKey"])')

  // Telefonisch, ohne Adresse.
  await page.getByLabel('Tisch').selectOption('t2')
  await page.getByLabel('Name').fill('Telefon Gast')
  await page.getByLabel('Personen').fill('3')
  await page.getByRole('button', { name: 'Buchung anlegen' }).click()
  await expect(page.getByText('Buchung angelegt.')).toBeVisible()
  const phoneBooking = await prisma.booking.findFirstOrThrow({ where: { eventId: event.id, name: 'Telefon Gast' } })
  expect(phoneBooking).toMatchObject({ status: 'CONFIRMED', source: 'ADMIN', email: null, partySize: 3 })
  expect(await tableOfBooking(phoneBooking.id)).toBe('t2')
  await expect(page).toHaveURL(new RegExp(`${detailUrl(event.id, phoneBooking.id)}\\?done=created$`))

  // Mit Adresse, direkt bestätigt: Bestätigungsmail mit funktionierendem Verwaltungslink.
  const direct = uniqueEmail('direkt')
  const created = await submitForm(page, form, { unitKey: 't3', name: 'Direkt Gast', partySize: '5', email: direct, confirm: 'direct', notify: 'on' })
  expect(created.status()).toBe(303)
  const confirmation = await waitForMail(direct)
  expect(confirmation.subject).toBe('Buchung bestätigt – Testevent')
  expect((await page.goto(manageLinkOf(confirmation.text ?? '')))?.status()).toBe(200)

  // Eine Buchung pro Adresse gilt auch hier.
  expect(await (await submitForm(page, form, { unitKey: 't4', name: 'Nochmal', partySize: '2', email: direct })).text()).toContain('schon eine aktive Buchung')
  // Belegter Tisch (nachgespielt).
  expect(await (await submitForm(page, form, { unitKey: 't1', name: 'Zu spät', partySize: '2' })).text()).toContain('Tisch 1 ist belegt.')
  expect(await prisma.booking.count({ where: { eventId: event.id, name: { in: ['Nochmal', 'Zu spät'] } } })).toBe(0)

  // Mit Bestätigung per Mail: PENDING mit Frist, Verifizierungsmail.
  const verify = uniqueEmail('verify')
  expect((await submitForm(page, form, { unitKey: 't4', name: 'Mail Gast', partySize: '2', email: verify, confirm: 'verify' })).status()).toBe(303)
  const verifyMail = await waitForMail(verify)
  const link = verifyLinkOf(verifyMail.text ?? '')
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: link.bookingId } })).toMatchObject({ status: 'PENDING', source: 'ADMIN' })
})

test('Verwaltungslink neu erzeugen: alter Link 404, neuer kommt per Mail', async ({ page }) => {
  const { owner, event } = await ownedEvent()
  const email = uniqueEmail('neulink')
  const booking = await createBooking(event.id, ['t1'], { email })
  const oldLink = `/b/${booking.id}/${manageToken(booking.id, 1)}`
  expect((await page.goto(oldLink))?.status()).toBe(200)

  await login(page, owner.email)
  await page.goto(detailUrl(event.id, booking.id))
  await expect(page.getByLabel('Persönlicher Link der Kund*in (nicht weitergeben)')).toHaveValue(new RegExp(`${oldLink}$`))
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Link neu erzeugen' }).click()
  await expect(page.getByText('Neuer Verwaltungslink erzeugt')).toBeVisible()
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).manageTokenVersion).toBe(2)

  expect((await page.goto(oldLink))?.status()).toBe(404)
  const mail = await waitForMail(email)
  expect(mail.subject).toBe('Neuer Link zu deiner Buchung – Testevent')
  const newLink = manageLinkOf(mail.text ?? '')
  expect(newLink).toContain(manageToken(booking.id, 2))
  expect((await page.goto(newLink))?.status()).toBe(200)
})

test('Rundmail: Testversand an sich selbst, Filter, Einzelmails über die Warteschlange, MailLog', async ({ page }) => {
  const { owner, event } = await ownedEvent({ capacities: [8, 8, 8, 8, 8] })
  const a = uniqueEmail('rund-a')
  const b = uniqueEmail('rund-b')
  const c = uniqueEmail('rund-c')
  const d = uniqueEmail('rund-d')
  const bookingA = await createBooking(event.id, ['t1'], { email: a, name: 'Anna A' })
  await createBooking(event.id, ['t2'], { email: b, name: 'Ben B' })
  await createBooking(event.id, ['t3'], { email: c, status: 'PENDING', expiresAt: new Date(Date.now() + 20 * 60_000) })
  await createBooking(event.id, ['t4'], { email: null })
  await createBooking(event.id, [], { email: d, status: 'CANCELLED' })

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/mail`)
  await expect(page.getByTestId('recipient-count')).toContainText('2 Empfänger*innen')
  await page.getByLabel('auch unbestätigte Reservierungen').check()
  await expect(page.getByTestId('recipient-count')).toContainText('3 Empfänger*innen')
  await page.getByLabel('nur bestätigte Buchungen').check()

  await page.getByLabel('Betreff').fill('Einlass ab 18 Uhr')
  await page.getByLabel('Text').fill('Liebe Gäste,\nder Einlass beginnt um 18 Uhr.')
  await expect(page.getByTestId('broadcast-preview')).toContainText('der Einlass beginnt um 18 Uhr.')

  await page.getByRole('button', { name: 'Testmail an mich schicken' }).click()
  await expect(page.getByText(`Testmail an ${owner.email} verschickt.`)).toBeVisible()
  const testMail = await waitForMail(owner.email)
  expect(testMail.subject).toBe('[Test] Einlass ab 18 Uhr')
  expect(testMail.text).toContain('Erika Beispiel')
  expect(await mailsTo(a)).toHaveLength(0)

  // Ohne Bestätigung wird nichts verschickt.
  const sendForm = await readForm(page, 'form:has(textarea[name="body"])')
  const unconfirmed = await submitForm(page, sendForm, { subject: 'X', body: 'Y', confirmSend: '' })
  expect(await unconfirmed.text()).toContain('Bitte bestätige, dass die Rundmail verschickt werden soll.')
  expect(await prisma.broadcast.count({ where: { eventId: event.id } })).toBe(0)

  await page.getByLabel('Betreff').fill('Einlass ab 18 Uhr')
  await page.getByLabel('Text').fill('Liebe Gäste,\nder Einlass beginnt um 18 Uhr.')
  await page.getByLabel(/Ja, an 2 Empfänger\*innen verschicken/).check()
  await page.getByRole('button', { name: 'Rundmail verschicken' }).click()
  await expect(page.getByText('Rundmail an 2 Empfänger*innen eingereiht.')).toBeVisible()

  const mailA = await waitForMail(a)
  const mailB = await waitForMail(b)
  expect(mailA.subject).toBe('Einlass ab 18 Uhr')
  expect(mailA.text).toContain('der Einlass beginnt um 18 Uhr.')
  expect(mailA.text).toContain('Name: Anna A')
  expect(manageLinkOf(mailA.text ?? '')).toContain(`/b/${bookingA.id}/`)
  expect(mailB.text).toContain('Name: Ben B')
  expect(mailA.attachments).toHaveLength(0)
  await page.waitForTimeout(500)
  expect(await mailsTo(c)).toHaveLength(0)
  expect(await mailsTo(d)).toHaveLength(0)
  await expect.poll(() => prisma.mailLog.count({ where: { eventId: event.id, type: 'broadcast', status: 'sent' } })).toBe(2)

  // Zweite Rundmail: auch Unbestätigte, nur Tisch 3, mit Kalenderdatei (die Unbestätigte nicht bekommt).
  await page.goto(`/admin/events/${event.id}/mail`)
  await expect(page.getByTestId('broadcasts')).toContainText('2 verschickt')
  await page.getByLabel('Betreff').fill('Nur für Tisch 3')
  await page.getByLabel('Text').fill('Hallo Tisch 3')
  await page.getByLabel('auch unbestätigte Reservierungen').check()
  await page.getByLabel('nur diese Tische:').check()
  await page.getByLabel('Tisch 3').check()
  await page.getByLabel(/Kalendereintrag anhängen/).check()
  await expect(page.getByTestId('recipient-count')).toContainText('1 Empfänger*in ')
  await page.getByLabel(/Ja, an 1 Empfänger\*in verschicken/).check()
  await page.getByRole('button', { name: 'Rundmail verschicken' }).click()
  await expect(page.getByText('Rundmail an 1 Empfänger*in eingereiht.')).toBeVisible()
  const mailC = await waitForMail(c)
  expect(mailC.subject).toBe('Nur für Tisch 3')
  expect(mailC.text).not.toContain('/b/')
  expect(mailC.attachments).toHaveLength(0)
  expect(await mailsTo(a)).toHaveLength(1)

  const audit = await prisma.auditLog.findMany({ where: { eventId: event.id, bookingId: null, action: 'broadcast' } })
  expect(audit).toHaveLength(2)
})

test('Warteschlange: Cron setzt Hängengebliebenes auf gescheitert und verschickt Liegengebliebenes; storniert = übersprungen', async ({ request }) => {
  const { owner, event } = await ownedEvent()
  const email = uniqueEmail('queue')
  const booking = await createBooking(event.id, ['t1'], { email })
  const cancelled = await createBooking(event.id, [], { status: 'CANCELLED' })
  const broadcast = await prisma.broadcast.create({ data: { eventId: event.id, subject: 'Nachgereicht', body: 'Text', createdById: owner.id } })
  const queued = await prisma.mailLog.create({ data: { eventId: event.id, bookingId: booking.id, broadcastId: broadcast.id, type: 'broadcast', recipient: email, status: 'queued' } })
  const skipped = await prisma.mailLog.create({ data: { eventId: event.id, bookingId: cancelled.id, broadcastId: broadcast.id, type: 'broadcast', recipient: cancelled.email!, status: 'queued' } })
  const stuck = await prisma.mailLog.create({
    data: { eventId: event.id, bookingId: booking.id, broadcastId: broadcast.id, type: 'broadcast', recipient: email, status: 'sending', claimedAt: new Date(Date.now() - 20 * 60_000) }
  })

  const response = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)
  expect((await response.json()).stuckMails).toBeGreaterThanOrEqual(1)
  expect((await prisma.mailLog.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe('failed')

  expect((await waitForMail(email)).subject).toBe('Nachgereicht')
  await expect.poll(async () => (await prisma.mailLog.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe('sent')
  await expect.poll(async () => (await prisma.mailLog.findUniqueOrThrow({ where: { id: skipped.id } })).status).toBe('skipped')
  // Die hängengebliebene Zeile wurde nicht noch einmal verschickt.
  expect(await mailsTo(email)).toHaveLength(1)
})

test('Berechtigung: Moderator*in mit Freigabe darf, fremdes Konto nicht, Buchung eines anderen Events nicht', async ({ page, browser }) => {
  const { owner, event } = await ownedEvent()
  const booking = await createBooking(event.id, ['t1'])
  const other = await ownedEvent()
  const foreignBooking = await createBooking(other.event.id, ['t1'])

  // Buchung eines fremden Events unter der eigenen Event-URL: 404.
  await login(page, owner.email)
  expect((await page.goto(detailUrl(event.id, foreignBooking.id)))?.status()).toBe(404)
  await page.goto(detailUrl(event.id, booking.id))
  const cancel = await readForm(page, 'form:has(button:text("Buchung stornieren"))')
  // Eigenes Event, fremde Buchungs-id: abgelehnt.
  expect(await (await submitForm(page, cancel, { bookingId: foreignBooking.id })).text()).toContain('Diese Buchung gibt es nicht')
  // Fremdes Event (kein Zugriff): Weiterleitung, nichts passiert.
  const wrongEvent = await submitForm(page, cancel, { eventId: other.event.id, bookingId: foreignBooking.id })
  expect(wrongEvent.status()).toBe(303)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: foreignBooking.id } })).status).toBe('CONFIRMED')

  // Fremdes Konto spielt das Formular nach.
  const stranger = await strangerPage(browser)
  const byStranger = await submitForm(stranger, cancel)
  expect(byStranger.status()).toBe(303)
  expect(byStranger.headers()['location']).toContain('/admin/events')
  // Ohne Sitzung: zur Anmeldung.
  const anonymous = await (await browser.newContext()).newPage()
  const byAnonymous = await submitForm(anonymous, cancel)
  expect(byAnonymous.headers()['location']).toContain('/login')
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED')

  // Positivkontrolle: Moderator*in mit Freigabe storniert.
  const moderator = await createAccount('MODERATOR')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  const moderatorPage = await (await browser.newContext()).newPage()
  await login(moderatorPage, moderator.email)
  const byModerator = await submitForm(moderatorPage, cancel)
  expect(byModerator.status()).toBe(303)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED')
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { bookingId: booking.id, action: 'cancelled' } })
  expect(audit.actor).toBe(moderator.id)
})

test('Druckansicht und Tischkarten: nur aktive Buchungen, unbestätigte markiert', async ({ page }) => {
  const { owner, event } = await ownedEvent()
  await createBooking(event.id, ['t2'], { name: 'Zweiter Tisch', partySize: 6, note: 'Rollstuhl' })
  await createBooking(event.id, ['t1'], { name: 'Erster Tisch', status: 'PENDING', expiresAt: new Date(Date.now() + 10 * 60_000) })
  await createBooking(event.id, [], { name: 'Storniert', status: 'CANCELLED' })

  expect((await page.goto(`/admin/events/${event.id}/print`))?.url()).toContain('/login')
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/print`)
  const rows = page.getByRole('table').getByRole('row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1)).toContainText('Erster Tisch')
  await expect(rows.nth(1)).toContainText('(unbestätigt)')
  await expect(rows.nth(2)).toContainText('Rollstuhl')
  await expect(page.getByText('2 Tische, 10 Personen')).toBeVisible()
  await expect(page.getByRole('main')).not.toContainText('Storniert')

  await page.getByRole('link', { name: 'Tischkarten' }).click()
  await expect(page.getByTestId('table-card')).toHaveCount(2)
  await expect(page.getByTestId('table-card').first()).toContainText('Tisch 1')
})
