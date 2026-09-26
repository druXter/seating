import { createHmac } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { manageToken } from '../../app/lib/booking-tokens'
import {
  captureAction, createAccount, createBooking, createEventRecord, manageLinkOf, prisma, readForm, replayAction, sha256,
  submitForm, tablesLayout, uniqueEmail, uniqueIp, verifyLinkOf
} from './helpers'
import { REJECTED_DOMAIN, mailsTo, waitForMail } from './mail-server'

// Tischbuchung TABLE + OPEN (Phase 3): Reservieren, Bestätigen per Link oder Code, Verfall,
// gleichzeitige Buchungen, eine Buchung pro Adresse, Drosselung, Verwaltungslink, .ics.
// Jeder Angriffsfall mit Positivkontrolle.

async function openEvent(options: { capacities?: number[]; oneBookingPerEmail?: boolean; startsAt?: Date } = {}) {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: tablesLayout(options.capacities ?? [8, 4, 6, 8, 6, 8]), startsAt: options.startsAt })
  if (options.oneBookingPerEmail === false) await prisma.event.update({ where: { id: event.id }, data: { oneBookingPerEmail: false } })
  return event
}

async function fillReservation(page: Page, table: string, data: { name?: string; email: string; partySize?: number }) {
  await page.getByRole('button', { name: `${table} buchen` }).click()
  await page.getByLabel('Name').fill(data.name ?? 'Erika Muster')
  await page.getByLabel('E-Mail').fill(data.email)
  await page.getByLabel('Personen', { exact: true }).fill(String(data.partySize ?? 4))
  await page.getByLabel('Personen (zur Kontrolle wiederholen)').fill(String(data.partySize ?? 4))
  await page.getByLabel(/Datenschutzhinweis/).check()
}

async function reserveViaUi(page: Page, slug: string, table: string, data: { name?: string; email: string; partySize?: number }) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto(`/${slug}`)
  await fillReservation(page, table, data)
  await page.getByRole('button', { name: 'Tisch reservieren' }).click()
  await expect(page.getByText(`${table} ist bis`)).toBeVisible()
}

async function bookingsOf(eventId: string, email: string) {
  return prisma.booking.findMany({ where: { eventId, email }, include: { allocations: { include: { unit: true } } }, orderBy: { createdAt: 'asc' } })
}

test('Buchung per Link: reservieren, GET bestätigt nicht, Button bestätigt, Mail mit .ics und Verwaltungslink', async ({ page, browser }) => {
  const event = await openEvent()
  const email = uniqueEmail('link')
  await reserveViaUi(page, event.slug, 'Tisch 1', { email, partySize: 5 })

  const [pending] = await bookingsOf(event.id, email)
  expect(pending).toMatchObject({ status: 'PENDING', partySize: 5, name: 'Erika Muster', verifyAttempts: 0 })
  expect(pending.allocations.map(a => a.unit.key)).toEqual(['t1'])
  expect(pending.expiresAt!.getTime() - Date.now()).toBeGreaterThan(25 * 60_000)
  expect(pending.pendingIpHash).toMatch(/^[a-f0-9]{64}$/)

  // Öffentlich sofort belegt.
  const other = await browser.newPage()
  await other.goto(`/${event.slug}`)
  await expect(other.getByRole('row').filter({ hasText: 'Tisch 1' })).toContainText('belegt')

  const mail = await waitForMail(email)
  expect(mail.subject).toBe('Bitte bestätige deine Reservierung – Testevent')
  const link = verifyLinkOf(mail.text ?? '')
  expect(link.bookingId).toBe(pending.id)
  // Link nur als SHA-256, Code nur als HMAC (nie im Klartext, nie als reiner Hash).
  expect(pending.verifyTokenHash).toBe(sha256(link.token))
  expect(pending.verifyCodeHmac).not.toContain(link.code)
  expect(pending.verifyCodeHmac).not.toBe(sha256(link.code))

  // Mail-Scanner: GET auf den Link bestätigt nichts.
  expect((await other.request.get(link.url)).status()).toBe(200)
  expect((await other.request.get(link.url)).status()).toBe(200)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING')

  await other.goto(link.url)
  await expect(other.locator('dd', { hasText: 'Tisch 1' })).toBeVisible()
  await other.getByRole('button', { name: 'Buchung bestätigen' }).click()
  await expect(other).toHaveURL(/\/b\/[a-z0-9]+\/[\w-]+\?confirmed=1$/)
  await expect(other.getByText('Deine Buchung ist bestätigt.')).toBeVisible()

  const confirmed = await prisma.booking.findUniqueOrThrow({ where: { id: pending.id } })
  expect(confirmed).toMatchObject({ status: 'CONFIRMED', expiresAt: null, verifyTokenHash: null, verifyCodeHmac: null, pendingIpHash: null })
  expect(confirmed.emailVerifiedAt).not.toBeNull()

  const confirmation = await waitForMail(email, 2)
  expect(confirmation.subject).toBe('Buchung bestätigt – Testevent')
  expect(manageLinkOf(confirmation.text ?? '')).toBe(other.url().replace('?confirmed=1', ''))
  const ics = confirmation.attachments.find(a => a.filename === `${event.slug}.ics`)
  expect(ics?.contentType).toBe('text/calendar')
  const calendar = ics!.content.toString('utf8')
  expect(calendar).toContain('METHOD:PUBLISH\r\n')
  expect(calendar).toContain(`UID:booking-${pending.id}@127.0.0.1\r\n`)
  expect(calendar).toContain('SEQUENCE:0\r\n')
  expect(calendar.replace(/\r\n /g, '')).toContain(`/b/${pending.id}/`)

  // Der Link ist verbraucht.
  await other.goto(link.url)
  await expect(other.getByText('Dieser Link ist ungültig')).toBeVisible()
})

test('Bestätigung per Code; nach 5 falschen Codes gesperrt; neue Mail setzt zurück, ohne zu verlängern', async ({ page }) => {
  const event = await openEvent()
  const email = uniqueEmail('code')
  await reserveViaUi(page, event.slug, 'Tisch 2', { email, partySize: 3 })
  const first = verifyLinkOf((await waitForMail(email)).text ?? '')
  const [booking] = await bookingsOf(event.id, email)
  const wrong = first.code === '000000' ? '111111' : '000000'

  const code = page.getByLabel('Code aus der Mail')
  for (let i = 1; i <= 4; i++) {
    await code.fill(wrong)
    await page.getByRole('button', { name: 'Bestätigen' }).click()
    await expect(page.getByText('Der Code stimmt nicht.')).toBeVisible()
    await expect.poll(async () => (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).verifyAttempts).toBe(i)
  }
  await code.fill(wrong)
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Zu viele falsche Codes.')).toBeVisible()
  // Auch der richtige Code hilft jetzt nicht mehr.
  await code.fill(first.code)
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Zu viele falsche Codes.')).toBeVisible()
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('PENDING')

  await page.getByRole('button', { name: 'Keine Mail bekommen? Erneut senden' }).click()
  await expect(page.getByText('Falls die Reservierung noch besteht, ist eine neue Mail unterwegs.')).toBeVisible()
  const second = verifyLinkOf((await waitForMail(email, 2)).text ?? '')
  const resent = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  expect(resent.verifyAttempts).toBe(0)
  expect(resent.expiresAt).toEqual(booking.expiresAt)
  expect(resent.verifyTokenHash).toBe(sha256(second.token))

  // Der alte Link ist ungültig, der neue Code wirkt.
  await page.goto(first.url)
  await expect(page.getByText('Dieser Link ist ungültig')).toBeVisible()
  await page.goto(second.url)
  await page.getByRole('button', { name: 'Buchung bestätigen' }).click()
  await expect(page.getByText('Deine Buchung ist bestätigt.')).toBeVisible()
})

test('Code-Eingabe direkt nach dem Reservieren bestätigt und verlinkt die Buchung', async ({ page }) => {
  const event = await openEvent()
  const email = uniqueEmail('direkt')
  await reserveViaUi(page, event.slug, 'Tisch 3', { email, partySize: 6 })
  const { code } = verifyLinkOf((await waitForMail(email)).text ?? '')
  await page.getByLabel('Code aus der Mail').fill(`${code.slice(0, 3)} ${code.slice(3)}`)
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Deine Buchung ist bestätigt.')).toBeVisible()
  await page.getByRole('link', { name: 'Buchung ansehen oder ändern' }).click()
  await expect(page.getByRole('heading', { name: 'Deine Buchung' })).toBeVisible()
  expect((await bookingsOf(event.id, email))[0].status).toBe('CONFIRMED')
})

test('abgelaufene Reservierung: Link und Code abgelehnt, Tisch wieder frei, Cron setzt EXPIRED', async ({ page, request }) => {
  const event = await openEvent()
  const email = uniqueEmail('abgelaufen')
  await reserveViaUi(page, event.slug, 'Tisch 1', { email })
  const link = verifyLinkOf((await waitForMail(email)).text ?? '')
  const [booking] = await bookingsOf(event.id, email)
  await prisma.booking.update({ where: { id: booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } })

  await page.getByLabel('Code aus der Mail').fill(link.code)
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Die Reservierung ist abgelaufen')).toBeVisible()
  await page.goto(link.url)
  await expect(page.getByText('Die Reservierung ist abgelaufen')).toBeVisible()
  await page.goto(`/${event.slug}`)
  await expect(page.getByRole('row').filter({ hasText: 'Tisch 1' })).toContainText('frei')

  expect((await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)).status()).toBe(200)
  const expired = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  expect(expired).toMatchObject({ status: 'EXPIRED', verifyTokenHash: null, pendingIpHash: null })
  expect(await prisma.allocation.count({ where: { bookingId: booking.id } })).toBe(0)
  expect(await prisma.auditLog.count({ where: { bookingId: booking.id, action: 'expired' } })).toBe(1)
})

test('gleichzeitige Reservierungen desselben Tisches: genau eine gewinnt', async ({ page }) => {
  const event = await openEvent()
  await page.goto(`/${event.slug}`)
  await fillReservation(page, 'Tisch 2', { email: uniqueEmail('erste'), partySize: 3 })
  const action = await captureAction(page, () => page.getByRole('button', { name: 'Tisch reservieren' }).click())
  await expect(page.getByText('Tisch 2 ist bis')).toBeVisible()

  const emails = Array.from({ length: 8 }, (_, i) => uniqueEmail(`gleichzeitig${i}`))
  const responses = await Promise.all(emails.map(email => replayAction(page, action, { unitKey: 't1', email })))
  expect(responses.every(r => r.status() === 200)).toBe(true)

  const holders = await prisma.booking.findMany({ where: { eventId: event.id, email: { in: emails }, allocations: { some: {} } } })
  expect(holders).toHaveLength(1)
  expect(await prisma.allocation.count({ where: { eventId: event.id, unit: { key: 't1' } } })).toBe(1)
  const bodies = await Promise.all(responses.map(r => r.text()))
  expect(bodies.filter(b => b.includes('wurde gerade vergeben')).length).toBe(7)
})

test('eine Buchung pro Adresse: Seite verrät nichts, Hinweis geht an die Adresse; abschaltbar', async ({ page }) => {
  const event = await openEvent()
  const email = uniqueEmail('doppelt')
  const existing = await createBooking(event.id, ['t1'], { email, status: 'CONFIRMED' })

  await reserveViaUi(page, event.slug, 'Tisch 2', { email, partySize: 3 })
  await expect(page.getByText(`Wir haben eine Mail an ${email} geschickt`)).toBeVisible()
  expect(await prisma.booking.count({ where: { eventId: event.id, email } })).toBe(1)
  const notice = await waitForMail(email)
  expect(notice.subject).toBe('Deine Buchung – Testevent')
  expect(manageLinkOf(notice.text ?? '')).toContain(`/b/${existing.id}/${manageToken(existing.id, 1)}`)
  // Die Schein-Reservierung verhält sich bei der Code-Eingabe wie eine echte mit falschem Code.
  await page.getByLabel('Code aus der Mail').fill('123456')
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Der Code stimmt nicht.')).toBeVisible()

  // Positivkontrolle: abgeschaltet sind mehrere Buchungen möglich.
  await prisma.event.update({ where: { id: event.id }, data: { oneBookingPerEmail: false } })
  await reserveViaUi(page, event.slug, 'Tisch 2', { email, partySize: 3 })
  expect(await prisma.booking.count({ where: { eventId: event.id, email } })).toBe(2)
})

test('Obergrenze unbestätigter Reservierungen pro IP und Drosselung pro IP', async ({ page }) => {
  const event = await openEvent({ capacities: [8, 8, 8, 8, 8, 8] })
  await page.goto(`/${event.slug}`)
  await fillReservation(page, 'Tisch 1', { email: uniqueEmail('ip0') })
  const ip = uniqueIp()
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip })
  const action = await captureAction(page, () => page.getByRole('button', { name: 'Tisch reservieren' }).click())
  await expect(page.getByText('Tisch 1 ist bis')).toBeVisible()

  // Zwei weitere von derselben IP gehen, die vierte nicht.
  for (const table of ['t2', 't3']) expect(await (await replayAction(page, action, { unitKey: table, email: uniqueEmail('ip') }, ip)).text()).toContain('"pending"')
  expect(await (await replayAction(page, action, { unitKey: 't4', email: uniqueEmail('ip') }, ip)).text()).toContain('mehrere unbestätigte Reservierungen')
  // Positivkontrolle: von einer anderen IP klappt es.
  expect(await (await replayAction(page, action, { unitKey: 't4', email: uniqueEmail('ip') })).text()).toContain('"pending"')

  // Drosselung: 10 Versuche pro IP und Stunde, der 11. wird gar nicht erst geprüft.
  for (let i = 5; i <= 10; i++) await replayAction(page, action, { unitKey: 't5', email: uniqueEmail('drossel') }, ip)
  expect(await (await replayAction(page, action, { unitKey: 't5', email: uniqueEmail('drossel') }, ip)).text()).toContain('Zu viele Versuche')
  expect(await prisma.booking.count({ where: { eventId: event.id, allocations: { some: { unit: { key: 't5' } } } } })).toBe(0)
})

test('Mailversand scheitert: nichts bleibt reserviert, Fehler im MailLog', async ({ page }) => {
  const event = await openEvent()
  const email = uniqueEmail('kaputt', REJECTED_DOMAIN)
  await page.goto(`/${event.slug}`)
  await fillReservation(page, 'Tisch 1', { email })
  await page.getByRole('button', { name: 'Tisch reservieren' }).click()
  await expect(page.getByText('Die Bestätigungsmail konnte nicht verschickt werden.')).toBeVisible()

  const [booking] = await bookingsOf(event.id, email)
  expect(booking.status).toBe('EXPIRED')
  expect(booking.allocations).toHaveLength(0)
  expect(await prisma.mailLog.findFirst({ where: { bookingId: booking.id } })).toMatchObject({ type: 'verify', status: 'failed' })
  await page.goto(`/${event.slug}`)
  await expect(page.getByRole('row').filter({ hasText: 'Tisch 1' })).toContainText('frei')
})

test('Buchung außerhalb des Zeitraums, für unpassende oder nicht buchbare Tische wird abgelehnt', async ({ page }) => {
  const event = await openEvent({ capacities: [8, 4] })
  await prisma.event.update({ where: { id: event.id }, data: { minFillRatio: 0.5 } })
  await page.goto(`/${event.slug}`)
  await fillReservation(page, 'Tisch 1', { email: uniqueEmail('regeln'), partySize: 4 })
  const action = await captureAction(page, () => page.getByRole('button', { name: 'Tisch reservieren' }).click())
  await expect(page.getByText('Tisch 1 ist bis')).toBeVisible()

  // 3 Personen an einen 8er-Tisch mit 50 % Mindestbelegung, 5 an einen 4er, erfundener Tisch.
  expect(await (await replayAction(page, action, { unitKey: 't1', partySize: '3', partySizeConfirm: '3', email: uniqueEmail('r') })).text()).toContain('passt nicht zu 3 Personen')
  expect(await (await replayAction(page, action, { unitKey: 't2', partySize: '5', partySizeConfirm: '5', email: uniqueEmail('r') })).text()).toContain('passt nicht zu 5 Personen')
  expect(await (await replayAction(page, action, { unitKey: 't99', email: uniqueEmail('r') })).text()).toContain('Diesen Tisch kann man nicht buchen')

  // Buchung geschlossen: Status, Zeitraum.
  await prisma.event.update({ where: { id: event.id }, data: { status: 'CLOSED' } })
  expect(await (await replayAction(page, action, { unitKey: 't2', partySize: '2', partySizeConfirm: '2', email: uniqueEmail('r') })).text()).toContain('Die Buchung ist geschlossen.')
  await prisma.event.update({ where: { id: event.id }, data: { status: 'OPEN', bookingOpensAt: new Date(Date.now() + 86_400_000) } })
  expect(await (await replayAction(page, action, { unitKey: 't2', partySize: '2', partySizeConfirm: '2', email: uniqueEmail('r') })).text()).toContain('Buchen kannst du ab')
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(1)

  // Positivkontrolle.
  await prisma.event.update({ where: { id: event.id }, data: { bookingOpensAt: null } })
  expect(await (await replayAction(page, action, { unitKey: 't2', partySize: '2', partySizeConfirm: '2', email: uniqueEmail('r') })).text()).toContain('"pending"')
})

test('Verwaltungslink: falscher Token 404, altes Secret gilt, ändern mit Mail und SEQUENCE+1, Tischwechsel, Storno', async ({ page, browser }) => {
  const event = await openEvent()
  const email = uniqueEmail('verwalten')
  const booking = await createBooking(event.id, ['t1'], { email, status: 'CONFIRMED', partySize: 4, name: 'Max Muster' })
  const other = await createBooking(event.id, ['t4'], { status: 'CONFIRMED' })
  const url = `/b/${booking.id}/${manageToken(booking.id, 1)}`

  const token = manageToken(booking.id, 1)
  for (const wrong of [`/b/${booking.id}/${token.slice(0, -2)}xx`, `/b/${other.id}/${token}`, `/b/${booking.id}/${manageToken(booking.id, 2)}`]) {
    expect((await page.goto(wrong))?.status(), wrong).toBe(404)
  }
  // Schlüsselrotation: mit dem vorherigen Secret abgeleitete Links gelten weiter.
  const previous = createHmac('sha256', process.env.MANAGE_LINK_SECRET_PREVIOUS!).update(`${booking.id}:1`).digest('base64url')
  expect((await page.goto(`/b/${booking.id}/${previous}`))?.status()).toBe(200)

  await page.goto(url)
  await expect(page.getByText('Max Muster')).toBeVisible()
  // Nur eigener und freie Tische stehen zur Wahl.
  const options = await page.getByLabel('Tisch', { exact: true }).locator('option').allTextContents()
  expect(options.some(o => o.startsWith('Tisch 4'))).toBe(false)
  expect(options.some(o => o.startsWith('Tisch 1') && o.includes('aktuell'))).toBe(true)

  const change = await readForm(page, 'form:has(select[name="unitKey"])')
  // Belegten Tisch nachgespielt: abgelehnt, alles bleibt.
  const taken = await submitForm(page, change, { unitKey: 't4' })
  expect(await taken.text()).toContain('Tisch 4 wurde gerade vergeben')
  // Unpassende Personenzahl.
  expect(await (await submitForm(page, change, { partySize: '9' })).text()).toContain('passt nicht zu 9 Personen')
  expect(await prisma.allocation.findFirst({ where: { bookingId: booking.id }, include: { unit: true } })).toMatchObject({ unit: { key: 't1' } })

  // Positivkontrolle über die Oberfläche: Personen, Name, Tischwechsel.
  await page.getByLabel('Name').fill('Max Mustermann')
  await page.getByLabel('Personen', { exact: true }).fill('6')
  await page.getByLabel('Tisch', { exact: true }).selectOption('t3')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  const changed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { allocations: { include: { unit: true } } } })
  expect(changed).toMatchObject({ name: 'Max Mustermann', partySize: 6, icsSequence: 1 })
  expect(changed.allocations.map(a => a.unit.key)).toEqual(['t3'])
  const changeMail = await waitForMail(email)
  expect(changeMail.subject).toBe('Buchung geändert – Testevent')
  expect(changeMail.text).toContain('Geändert: Name, Personenzahl, Tisch.')
  expect(changeMail.attachments[0].content.toString()).toContain('SEQUENCE:1\r\n')
  expect(await prisma.auditLog.findFirst({ where: { bookingId: booking.id, action: 'changed' } })).not.toBeNull()

  // Stornieren: Tisch frei, Mail mit CANCEL.
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Buchung stornieren' }).click()
  await expect(page.getByText('Deine Buchung ist storniert.')).toBeVisible()
  const cancelled = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
  expect(cancelled).toMatchObject({ status: 'CANCELLED', icsSequence: 2 })
  expect(await prisma.allocation.count({ where: { bookingId: booking.id } })).toBe(0)
  const cancelMail = await waitForMail(email, 2)
  const cancelIcs = cancelMail.attachments[0].content.toString()
  expect(cancelIcs).toContain('METHOD:CANCEL\r\n')
  expect(cancelIcs).toContain('STATUS:CANCELLED\r\n')
  expect(cancelIcs).toContain(`UID:booking-${booking.id}@127.0.0.1\r\n`)
  // Nochmals ändern geht nicht mehr.
  expect(await (await submitForm(page, change, { name: 'Zu spät' })).text()).toContain('storniert')

  const visitor = await browser.newPage()
  await visitor.goto(`/${event.slug}`)
  await expect(visitor.getByRole('row').filter({ hasText: 'Tisch 3' })).toContainText('frei')
})

test('Verwaltungslink nach der Änderungsfrist: nur Anzeige, Aktionen nachgespielt wirkungslos', async ({ page }) => {
  const event = await openEvent()
  const booking = await createBooking(event.id, ['t1'], { status: 'CONFIRMED', partySize: 4 })
  const url = `/b/${booking.id}/${manageToken(booking.id, 1)}`
  await page.goto(url)
  const change = await readForm(page, 'form:has(select[name="unitKey"])')
  const cancel = await readForm(page, 'form:has(button:text("Buchung stornieren"))')

  // Beginn in 10 Stunden, Frist 24 Stunden vorher: abgelaufen.
  await prisma.event.update({ where: { id: event.id }, data: { startsAt: new Date(Date.now() + 10 * 3600_000), endsAt: new Date(Date.now() + 14 * 3600_000) } })
  await page.goto(url)
  await expect(page.getByText('nur bis')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Änderungen speichern' })).toHaveCount(0)
  expect(await (await submitForm(page, change, { partySize: '6' })).text()).toContain('Frist für Änderungen ist abgelaufen')
  expect(await (await submitForm(page, cancel)).text()).toContain('Frist für Stornierungen ist abgelaufen')
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: 'CONFIRMED', partySize: 4 })

  // Positivkontrolle: Frist 0 = bis Beginn.
  await prisma.event.update({ where: { id: event.id }, data: { selfEditHoursBefore: 0 } })
  expect((await submitForm(page, change, { partySize: '6' })).status()).toBe(303)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).partySize).toBe(6)
})

// Buchungsliste für Veranstalter*innen: tests/e2e/admin-bookings.spec.ts

test('Cron löscht abgelaufene und stornierte Buchungen nach 30 Tagen, bestätigte bleiben', async ({ request }) => {
  const event = await openEvent()
  const old = await createBooking(event.id, [], { status: 'CANCELLED' })
  const recent = await createBooking(event.id, [], { status: 'EXPIRED' })
  const active = await createBooking(event.id, ['t1'], { status: 'CONFIRMED' })
  await prisma.$executeRaw`UPDATE "Booking" SET "updatedAt" = ${new Date(Date.now() - 31 * 86_400_000)} WHERE "id" IN (${old.id}, ${active.id})`
  await prisma.auditLog.create({ data: { eventId: event.id, bookingId: old.id, actor: 'customer', action: 'cancelled', diff: {} } })

  expect((await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)).status()).toBe(200)
  expect(await prisma.booking.count({ where: { id: old.id } })).toBe(0)
  expect(await prisma.auditLog.count({ where: { bookingId: old.id } })).toBe(0)
  expect(await prisma.booking.count({ where: { id: recent.id } })).toBe(1)
  expect(await prisma.booking.count({ where: { id: active.id } })).toBe(1)
  expect(await mailsTo('niemand@example.test')).toHaveLength(0)
})
