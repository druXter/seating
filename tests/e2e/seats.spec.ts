import { expect, test, type Page } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { manageToken } from '../../app/lib/booking-tokens'
import {
  captureAction, createAccount, createBooking, createEventRecord, login, manageLinkOf, prisma, readForm, replayAction, submitForm,
  uniqueEmail, uniqueIp, verifyLinkOf
} from './helpers'
import { mailsTo, waitForMail } from './mail-server'

// Modus SEAT (Phase 5): Plätze wählen (Vorschlag, Plan, Liste), reservieren und bestätigen, gleichzeitige
// Buchungen überlappender Plätze, Obergrenze, erfundene/belegte/nicht buchbare Plätze, Ändern über den
// Verwaltungslink, Admin (Moduswechsel, Anlegen, Ändern, Druck), Warteliste nur für zusammenhängende Plätze.

/** Block 2 Reihen × 6 Plätze (Gang nach Platz 3) und ein runder Tisch mit 4 Plätzen. */
function seatLayout() {
  return {
    schemaVersion: 1, width: 2000, height: 1200, grid: 50, nextId: 3,
    elements: [
      {
        id: 'blk1', type: 'seatBlock', x: 1000, y: 400, rotation: 0, rows: 2, seatsPerRow: 6, seatSpacing: 55, rowSpacing: 90,
        rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [3], omitted: [], curveRadius: 0, bookable: true
      },
      { id: 't2', type: 'table', shape: 'round', x: 300, y: 800, rotation: 0, width: 150, height: 150, seats: 4, sides: { top: true, right: true, bottom: true, left: true }, bookable: true }
    ]
  }
}

const seat = (row: number, position: number) => `blk1-r${row}-s${position}`

async function seatEvent(options: { maxSeats?: number; owner?: { id: string; email: string } } = {}) {
  const owner = options.owner ?? await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: seatLayout() })
  await prisma.event.update({ where: { id: event.id }, data: { mode: 'SEAT', maxSeatsPerBooking: options.maxSeats ?? 10 } })
  return { owner, event }
}

async function keysOf(bookingId: string) {
  const allocations = await prisma.allocation.findMany({ where: { bookingId }, include: { unit: true } })
  return allocations.map(a => a.unit.key).sort()
}

/** Gruppe der Platzliste aufklappen (Reihe bzw. Tisch). */
async function openGroup(page: Page, label: string) {
  await page.locator('summary', { hasText: label }).first().click()
}

async function fillContact(page: Page, email: string) {
  await page.getByLabel('Name').fill('Sina Sitz')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel(/Datenschutzhinweis/).check()
}

test('Plätze buchen: Vorschlag, Plan und Liste, reservieren, per Code bestätigen, Mails mit Plätzen', async ({ page, browser }) => {
  const { event } = await seatEvent()
  await createBooking(event.id, [seat(1, 1)], { partySize: 1 })
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto(`/${event.slug}`)
  await expect(page.getByText('Wähle freie Plätze und reserviere sie.')).toBeVisible()

  // Drei nebeneinander: Reihe A links ist angebrochen, also rechts vom Gang.
  await page.getByLabel('Wie viele Plätze nebeneinander?').fill('3')
  await page.getByRole('button', { name: 'Plätze vorschlagen' }).click()
  await expect(page.getByTestId('seat-selection')).toContainText('3 Plätze gewählt')
  await expect(page.getByTestId('seat-selection')).toContainText('Reihe A, Platz 4; Reihe A, Platz 5; Reihe A, Platz 6')
  // Einen Platz im Plan dazu, einen in der Liste wieder weg.
  await page.locator(`[data-unit-key="${seat(2, 1)}"]`).click()
  await page.getByLabel('Reihe A, Platz 6').uncheck()
  await expect(page.getByTestId('seat-selection')).toContainText('3 Plätze gewählt')
  // Belegte Plätze lassen sich nicht wählen.
  await expect(page.getByLabel('Reihe A, Platz 1')).toBeDisabled()
  // Aufgeklappt bleibt aufgeklappt, auch wenn sich die Auswahl ändert.
  await expect(page.locator('details', { hasText: 'Reihe A' }).first()).toHaveAttribute('open', '')

  const email = uniqueEmail('sitz')
  await fillContact(page, email)
  await page.getByRole('button', { name: 'Plätze reservieren' }).click()
  await expect(page.getByText('Reihe A, Plätze 4, 5; Reihe B, Platz 1')).toBeVisible()

  const [booking] = await prisma.booking.findMany({ where: { eventId: event.id, email } })
  expect(booking).toMatchObject({ status: 'PENDING', partySize: 3 })
  expect(await keysOf(booking.id)).toEqual([seat(1, 4), seat(1, 5), seat(2, 1)].sort())
  const verify = await waitForMail(email)
  expect(verify.text).toContain('Plätze: Reihe A, Plätze 4, 5; Reihe B, Platz 1')
  expect(verify.text).toContain('werden die Plätze danach wieder frei')

  await page.getByLabel('Code aus der Mail').fill(verifyLinkOf(verify.text ?? '').code)
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Deine Buchung ist bestätigt.')).toBeVisible()
  const confirmation = await waitForMail(email, 2)
  expect(confirmation.text).toContain('Personen: 3')
  expect(confirmation.attachments[0].content.toString().replace(/\r\n /g, '')).toContain('Reihe A\\, Plätze 4\\, 5\\; Reihe B\\, Platz 1 · 3 Personen')

  // Öffentlich belegt - ohne Namen.
  const visitor = await browser.newPage()
  await visitor.goto(`/${event.slug}`)
  await expect(visitor.locator(`[data-unit-key="${seat(1, 4)}"]`)).toHaveAttribute('data-state', 'confirmed')
  await expect(visitor.locator(`[data-unit-key="${seat(1, 6)}"]`)).toHaveAttribute('data-state', 'free')
  expect(await visitor.content()).not.toContain('Sina')
})

test('überlappende Plätze gleichzeitig: genau eine Buchung gewinnt; Obergrenze, erfundene, belegte, nicht buchbare Plätze', async ({ page }) => {
  const { event } = await seatEvent()
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto(`/${event.slug}`)
  await openGroup(page, 'Reihe B')
  await page.getByLabel('Reihe B, Platz 1').check()
  await page.getByLabel('Reihe B, Platz 2').check()
  await page.getByLabel('Reihe B, Platz 3').check()
  await fillContact(page, uniqueEmail('erster'))
  const reserve = await captureAction(page, () => page.getByRole('button', { name: 'Plätze reservieren' }).click())
  await expect(page.getByText('für dich reserviert')).toBeVisible()
  // Jetzt schon belegt: nachgespielt mit anderer Adresse abgelehnt.
  expect(await (await replayAction(page, reserve, { email: uniqueEmail('zweiter') })).text()).toContain('ist schon vergeben')

  // 8 gleichzeitige Anfragen auf wieder freie Plätze: Der erste Platz wechselt (Reihe A 1 bzw. 5), Reihe B 2
  // und 3 haben alle gemeinsam - genau eine Buchung darf gewinnen.
  await prisma.booking.deleteMany({ where: { eventId: event.id } })
  const emails = Array.from({ length: 8 }, (_, i) => uniqueEmail(`parallel${i}`))
  await Promise.all(emails.map((email, i) => replayAction(page, reserve, { email, unitKey: i % 2 ? seat(1, 1) : seat(1, 5) }, uniqueIp())))
  const winners = await prisma.booking.findMany({ where: { eventId: event.id, email: { in: emails }, status: 'PENDING' } })
  expect(winners).toHaveLength(1)
  expect(await prisma.allocation.count({ where: { eventId: event.id, unit: { key: seat(2, 2) } } })).toBe(1)

  // Obergrenze: 3 Plätze bei höchstens 2.
  await prisma.booking.deleteMany({ where: { eventId: event.id } })
  await prisma.event.update({ where: { id: event.id }, data: { maxSeatsPerBooking: 2 } })
  expect(await (await replayAction(page, reserve, { email: uniqueEmail('max') })).text()).toContain('höchstens 2 Plätze')
  await prisma.event.update({ where: { id: event.id }, data: { maxSeatsPerBooking: 10 } })
  // Erfundener Platz, nicht buchbarer Platz.
  expect(await (await replayAction(page, reserve, { email: uniqueEmail('x'), unitKey: 'blk1-r9-s9' })).text()).toContain('Diesen Platz gibt es nicht.')
  await prisma.unit.updateMany({ where: { eventId: event.id, key: seat(2, 1) }, data: { bookable: false } })
  expect(await (await replayAction(page, reserve, { email: uniqueEmail('nb') })).text()).toContain('Reihe B, Platz 1 ist nicht buchbar.')
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(0)
  // Positivkontrolle: derselbe Aufruf mit buchbaren Plätzen wirkt.
  await prisma.unit.updateMany({ where: { eventId: event.id, key: seat(2, 1) }, data: { bookable: true } })
  await replayAction(page, reserve, { email: uniqueEmail('ok') })
  expect(await prisma.booking.count({ where: { eventId: event.id, status: 'PENDING' } })).toBe(1)
})

test('Verwaltungslink: Plätze tauschen und abgeben, Mail alt → neu, belegte Plätze abgelehnt', async ({ page }) => {
  const { event } = await seatEvent()
  const email = uniqueEmail('tausch')
  const booking = await createBooking(event.id, [seat(1, 1), seat(1, 2)], { email, partySize: 2 })
  await createBooking(event.id, [seat(1, 5)], { partySize: 1 })

  await page.goto(`/b/${booking.id}/${manageToken(booking.id, 1)}`)
  await expect(page.locator('dd', { hasText: 'Reihe A, Plätze 1, 2' })).toBeVisible()
  const change = await readForm(page, 'form:has(button:text("Änderungen speichern"))')
  // Nachgespielt mit einem belegten Platz: abgelehnt.
  const hijack = await submitForm(page, change, { unitKey: seat(1, 5) })
  expect(await hijack.text()).toContain('Reihe A, Platz 5 ist schon vergeben.')

  await page.getByLabel('Reihe A, Platz 2').uncheck()
  await page.getByLabel('Reihe A, Platz 4').check()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  expect(await keysOf(booking.id)).toEqual([seat(1, 1), seat(1, 4)])
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ partySize: 2, icsSequence: 1 })
  const mail = await waitForMail(email)
  expect(mail.text).toContain('Plätze: Reihe A, Plätze 1, 2 → Reihe A, Plätze 1, 4')

  // Einen Platz abgeben: Personenzahl sinkt mit (frisch laden - der Hinweis stünde sonst schon da).
  await page.goto(`/b/${booking.id}/${manageToken(booking.id, 1)}`)
  await expect(page.getByTestId('seat-selection')).toContainText('Reihe A, Platz 1; Reihe A, Platz 4')
  await page.getByLabel('Reihe A, Platz 4').uncheck()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  expect(await keysOf(booking.id)).toEqual([seat(1, 1)])
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).partySize).toBe(1)
})

test('Admin: Moduswechsel nur ohne Buchungen, Plätze ohne Obergrenze anlegen und ändern, Platzliste', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const tableEvent = await createEventRecord(owner.id, { status: 'OPEN', layout: seatLayout() })
  const blocking = await createBooking(tableEvent.id, ['t2'], { partySize: 4 })
  await login(page, owner.email)
  await page.goto(`/admin/events/${tableEvent.id}`)
  const settings = await readForm(page, 'form:has(input[name="pendingTtlMinutes"])')
  expect(await (await submitForm(page, settings, { mode: 'SEAT' })).text()).toContain('lässt sich nur ohne sie wechseln')
  await prisma.booking.delete({ where: { id: blocking.id } })
  expect((await submitForm(page, settings, { mode: 'SEAT' })).status()).toBe(303)
  expect((await prisma.event.findUniqueOrThrow({ where: { id: tableEvent.id } })).mode).toBe('SEAT')

  const { event } = await seatEvent({ maxSeats: 2, owner })
  await createBooking(event.id, [seat(1, 1)], { partySize: 1 })
  await page.goto(`/admin/events/${event.id}`)
  await expect(page.getByTestId('table-counts')).toContainText('Plätze: 15 frei')
  // Freier Platz im Plan -> anlegen mit Vorauswahl.
  await page.goto(`/admin/events/${event.id}/bookings/new?table=${seat(2, 6)}`)
  await expect(page.getByTestId('seat-selection')).toContainText('Reihe B, Platz 6')
  await openGroup(page, 'Tisch 2')
  await page.getByLabel('Tisch 2, Platz 1').check()
  await page.getByLabel('Tisch 2, Platz 3').check()
  await page.getByLabel('Name').fill('Verstreute Gruppe')
  await page.getByRole('button', { name: 'Buchung anlegen' }).click()
  await expect(page.getByText('Buchung angelegt.')).toBeVisible()
  const created = await prisma.booking.findFirstOrThrow({ where: { eventId: event.id, name: 'Verstreute Gruppe' } })
  expect(created).toMatchObject({ status: 'CONFIRMED', partySize: 3, source: 'ADMIN' })
  expect(await keysOf(created.id)).toEqual(['blk1-r2-s6', 't2-s1', 't2-s3'])
  await expect(page.locator('dd', { hasText: 'Reihe B, Platz 6; Tisch 2, Plätze 1, 3' })).toBeVisible()

  // Ändern: einen Platz tauschen.
  await page.getByLabel('Tisch 2, Platz 3').uncheck()
  await page.getByLabel('Tisch 2, Platz 2').check()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  expect(await keysOf(created.id)).toEqual(['blk1-r2-s6', 't2-s1', 't2-s2'])
  await expect(page.getByTestId('audit-log')).toContainText('Plätze: Reihe B, Platz 6; Tisch 2, Plätze 1, 3 → Reihe B, Platz 6; Tisch 2, Plätze 1, 2')

  await page.goto(`/admin/events/${event.id}/print`)
  await expect(page.getByRole('heading', { name: `${event.title} – Platzliste` })).toBeVisible()
  await expect(page.getByRole('table')).toContainText('Reihe B, Platz 6; Tisch 2, Plätze 1, 2')
})

test('Warteliste mit Plätzen: Angebot nur für zusammenhängende Plätze, Hinweis auf der Seite', async ({ page }) => {
  const { event } = await seatEvent()
  // Frei bleiben nur verstreute Plätze: Reihe A 1 und 3, Reihe B 2 und 5.
  const taken = [seat(1, 2), seat(1, 4), seat(1, 5), seat(1, 6), seat(2, 1), seat(2, 3), seat(2, 4), seat(2, 6)]
  const holders = await Promise.all(taken.map(key => createBooking(event.id, [key], { partySize: 1 })))
  await createBooking(event.id, ['t2-s1', 't2-s2', 't2-s3', 't2-s4'], { partySize: 4 })

  await page.goto(`/${event.slug}`)
  await page.getByLabel('Wie viele Plätze nebeneinander?').fill('2')
  await page.getByRole('button', { name: 'Plätze vorschlagen' }).click()
  await expect(page.getByText('Gerade sind keine 2 Plätze nebeneinander frei.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Auf die Warteliste' })).toBeVisible()

  const at = new Date(Date.now() - 10 * 60_000)
  const entry = await prisma.booking.create({
    data: { eventId: event.id, status: 'WAITLISTED', source: 'PUBLIC', name: 'Paar', email: uniqueEmail('paar'), partySize: 2, emailVerifiedAt: at, waitlistedAt: at }
  })
  // Nur verstreute Plätze frei: kein Angebot.
  expect((await page.request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)).status()).toBe(200)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('WAITLISTED')

  // Reihe A Platz 2 wird frei -> Plätze 1-3 nebeneinander: Angebot für die ersten beiden.
  await prisma.booking.delete({ where: { id: holders[0].id } })
  expect((await page.request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)).status()).toBe(200)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('OFFERED')
  expect(await keysOf(entry.id)).toEqual([seat(1, 1), seat(1, 2)])
  const offer = await waitForMail(entry.email!)
  expect(offer.subject).toBe('Plätze sind für euch frei – Testevent')
  expect(offer.text).toContain('Reihe A, Plätze 1, 2')
  await page.goto(manageLinkOf(offer.text ?? ''))
  await page.getByRole('button', { name: 'Angebot annehmen' }).click()
  await expect(page.getByText('Angebot angenommen')).toBeVisible()
  expect(await mailsTo(entry.email!)).toHaveLength(2)
})
