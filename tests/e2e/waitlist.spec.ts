import { expect, test, type Page } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { manageToken } from '../../app/lib/booking-tokens'
import {
  captureAction, createAccount, createBooking, createEventRecord, login, manageLinkOf, prisma, readForm, replayAction, submitForm,
  tablesLayout, uniqueEmail, uniqueIp, verifyLinkOf
} from './helpers'
import { mailsTo, waitForMail } from './mail-server'

// Warteliste mit Nachrück-Angebot (Phase 4b): Eintragen und bestätigen, Angebot an den ältesten
// passenden Eintrag, annehmen, ablehnen, Verfall, gleichzeitige Angebote, Admin. Jeder Angriffsfall
// mit Positivkontrolle.

/** Tisch 1 hat 4 Plätze, Tisch 2 hat 8; mit Mindestbelegung 50 % passen Gruppen von 2-4 nur an Tisch 1. */
async function openEvent(options: { waitlistEnabled?: boolean; capacities?: number[] } = {}) {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: tablesLayout(options.capacities ?? [4, 8]), minFillRatio: 0.5 })
  if (options.waitlistEnabled === false) await prisma.event.update({ where: { id: event.id }, data: { waitlistEnabled: false } })
  return { owner, event }
}

/** Bestätigter Eintrag auf der Warteliste, minutesAgo bestimmt die Reihenfolge. */
async function waitlistEntry(eventId: string, partySize: number, minutesAgo: number, email = uniqueEmail('wartend')) {
  const at = new Date(Date.now() - minutesAgo * 60_000)
  return prisma.booking.create({
    data: { eventId, status: 'WAITLISTED', source: 'PUBLIC', name: `Gruppe ${partySize}/${minutesAgo}`, email, partySize, emailVerifiedAt: at, waitlistedAt: at }
  })
}

async function statusOf(id: string) {
  return (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
}

async function tableOfBooking(bookingId: string) {
  return (await prisma.allocation.findFirst({ where: { bookingId }, include: { unit: true } }))?.unit.key ?? null
}

function cron(page: Page) {
  return page.request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
}

async function openWaitlistForm(page: Page, slug: string, partySize: number) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
  await page.goto(`/${slug}`)
  await page.getByLabel('Wie viele Personen seid ihr?').fill(String(partySize))
  await page.getByRole('button', { name: 'Auf die Warteliste' }).click()
}

async function fillWaitlistForm(page: Page, email: string, partySize: number) {
  await page.getByLabel('Name').fill('Wanda Warteliste')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Personen', { exact: true }).fill(String(partySize))
  await page.getByLabel('Personen (zur Kontrolle wiederholen)').fill(String(partySize))
  await page.getByLabel(/Datenschutzhinweis/).check()
}

test('eintragen nur ohne freien passenden Tisch, bestätigen per Code, eine pro Adresse, zu große Gruppen', async ({ page }) => {
  const { event } = await openEvent()
  await createBooking(event.id, ['t1'], { partySize: 4 })

  // Für 5 passt der freie 8er - kein Hinweis auf die Warteliste.
  await page.goto(`/${event.slug}`)
  await page.getByLabel('Wie viele Personen seid ihr?').fill('5')
  await expect(page.getByText('1 passender Tisch frei')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Auf die Warteliste' })).toHaveCount(0)
  // Für 20 gibt es gar keinen Tisch.
  await page.getByLabel('Wie viele Personen seid ihr?').fill('20')
  await expect(page.getByText('Für so viele Personen gibt es keinen passenden Tisch.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Auf die Warteliste' })).toHaveCount(0)

  // Für 3 passt nur Tisch 1 (belegt): eintragen.
  const email = uniqueEmail('warte')
  await openWaitlistForm(page, event.slug, 3)
  await fillWaitlistForm(page, email, 3)
  const join = await captureAction(page, () => page.getByRole('button', { name: 'Auf die Warteliste setzen' }).click())
  await expect(page.getByText('erst dann stehst du auf der Warteliste')).toBeVisible()

  const [entry] = await prisma.booking.findMany({ where: { eventId: event.id, email } })
  expect(entry).toMatchObject({ status: 'WAITLISTED', partySize: 3, emailVerifiedAt: null, waitlistedAt: null })
  expect(await prisma.allocation.count({ where: { bookingId: entry.id } })).toBe(0)
  const verifyMail = await waitForMail(email)
  expect(verifyMail.subject).toBe('Bitte bestätige deinen Eintrag auf der Warteliste – Testevent')
  const { code } = verifyLinkOf(verifyMail.text ?? '')

  await page.getByLabel('Code aus der Mail').fill(code)
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(page.getByText('Du stehst jetzt auf der Warteliste.')).toBeVisible()
  const confirmed = await prisma.booking.findUniqueOrThrow({ where: { id: entry.id } })
  expect(confirmed.status).toBe('WAITLISTED')
  expect(confirmed.waitlistedAt).not.toBeNull()
  expect(confirmed.verifyCodeHmac).toBeNull()
  const confirmation = await waitForMail(email, 2)
  expect(confirmation.subject).toBe('Du stehst auf der Warteliste – Testevent')
  await page.goto(manageLinkOf(confirmation.text ?? ''))
  await expect(page.getByRole('heading', { name: 'Dein Eintrag auf der Warteliste' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Von der Warteliste austragen' })).toBeVisible()

  // Nachgespielt: dieselbe Adresse nochmal -> nichts angelegt, Hinweis an die Adresse.
  await replayAction(page, join)
  expect(await prisma.booking.count({ where: { eventId: event.id, email } })).toBe(1)
  expect((await waitForMail(email, 3)).subject).toBe('Deine Buchung – Testevent')
  // Nachgespielt mit einer Gruppengröße, für die ein Tisch frei ist -> abgelehnt.
  const other = uniqueEmail('frei')
  const free = await replayAction(page, join, { email: other, partySize: '5', partySizeConfirm: '5' })
  expect(await free.text()).toContain('Gerade ist ein passender Tisch frei')
  expect(await prisma.booking.count({ where: { eventId: event.id, email: other } })).toBe(0)
})

test('Storno macht Tisch frei: Angebot an den ältesten passenden Eintrag, annehmen', async ({ page, browser }) => {
  const { event } = await openEvent()
  const holder = await createBooking(event.id, ['t1'], { partySize: 4 })
  await createBooking(event.id, ['t2'], { partySize: 8 })
  const big = await waitlistEntry(event.id, 8, 60)
  const first = await waitlistEntry(event.id, 3, 30)
  const second = await waitlistEntry(event.id, 2, 10)

  // Die Kund*in storniert Tisch 1 über den Verwaltungslink.
  page.on('dialog', dialog => dialog.accept())
  await page.goto(`/b/${holder.id}/${manageToken(holder.id, 1)}`)
  await page.getByRole('button', { name: 'Buchung stornieren' }).click()
  await expect(page.getByText('Deine Buchung ist storniert.')).toBeVisible()

  // Die 8er-Gruppe wartet länger, Tisch 1 passt aber nicht - das Angebot geht an die erste passende.
  await expect.poll(() => statusOf(first.id)).toBe('OFFERED')
  expect(await tableOfBooking(first.id)).toBe('t1')
  expect(await statusOf(big.id)).toBe('WAITLISTED')
  expect(await statusOf(second.id)).toBe('WAITLISTED')
  const offered = await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })
  expect(offered.expiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000)

  // Öffentlich ist Tisch 1 während des Angebots belegt.
  const visitor = await browser.newPage()
  await visitor.goto(`/${event.slug}`)
  await expect(visitor.getByRole('row').filter({ hasText: 'Tisch 1' })).toContainText('belegt')

  const offerMail = await waitForMail(first.email!)
  expect(offerMail.subject).toBe('Ein Tisch ist für euch frei – Testevent')
  expect(offerMail.text).toContain('Tisch 1 ist frei geworden')
  await page.goto(manageLinkOf(offerMail.text ?? ''))
  await expect(page.getByText('Ein Tisch ist für euch frei')).toBeVisible()
  await page.getByRole('button', { name: 'Angebot annehmen' }).click()
  await expect(page.getByText('Angebot angenommen')).toBeVisible()
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'CONFIRMED', expiresAt: null })
  const confirmation = await waitForMail(first.email!, 2)
  expect(confirmation.subject).toBe('Buchung bestätigt – Testevent')
  expect(confirmation.attachments[0].content.toString()).toContain('METHOD:PUBLISH\r\n')
  // Normale Verwaltungsseite: ändern und stornieren möglich.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Änderungen speichern' })).toBeVisible()
})

test('ablehnen gibt den Tisch an den Nächsten; Verfall per Cron mit Mail, dann der Nächste; abgelaufenes Angebot nicht annehmbar', async ({ page }) => {
  const { event } = await openEvent()
  await createBooking(event.id, ['t2'], { partySize: 8 })
  const a = await waitlistEntry(event.id, 3, 30)
  const b = await waitlistEntry(event.id, 3, 20)
  const c = await waitlistEntry(event.id, 3, 10)

  // Tisch 1 ist frei, aber noch hat niemand angeboten: der Hintergrund-Durchlauf (hier: Cron) holt es nach.
  expect((await cron(page)).status()).toBe(200)
  expect(await statusOf(a.id)).toBe('OFFERED')
  expect(await statusOf(b.id)).toBe('WAITLISTED')

  page.on('dialog', dialog => dialog.accept())
  await page.goto(`/b/${a.id}/${manageToken(a.id, 1)}`)
  await page.getByRole('button', { name: 'Angebot ablehnen' }).click()
  await expect(page.getByText('Du hast das Angebot abgelehnt')).toBeVisible()
  expect(await statusOf(a.id)).toBe('CANCELLED')
  await expect.poll(() => statusOf(b.id)).toBe('OFFERED')
  expect(await tableOfBooking(b.id)).toBe('t1')
  expect((await waitForMail(b.email!)).subject).toBe('Ein Tisch ist für euch frei – Testevent')

  // b reagiert nicht: Frist abgelaufen -> Cron setzt EXPIRED, schickt die Verfallsmail, bietet c an.
  await page.goto(`/b/${b.id}/${manageToken(b.id, 1)}`)
  const accept = await readForm(page, 'form:has(button:text("Angebot annehmen"))')
  await prisma.booking.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
  expect(await (await submitForm(page, accept)).text()).toContain('abgelaufen')
  expect(await statusOf(b.id)).toBe('OFFERED')
  expect((await cron(page)).status()).toBe(200)
  expect(await statusOf(b.id)).toBe('EXPIRED')
  expect(await statusOf(c.id)).toBe('OFFERED')
  expect((await waitForMail(b.email!, 2)).subject).toBe('Angebot verfallen – Testevent')
  expect((await waitForMail(c.email!)).subject).toBe('Ein Tisch ist für euch frei – Testevent')
  expect(await (await submitForm(page, accept)).text()).toContain('nicht mehr offen')
  await page.goto(`/b/${b.id}/${manageToken(b.id, 1)}`)
  await expect(page.getByText('Das Angebot ist verfallen')).toBeVisible()

  // Positivkontrolle: dasselbe Formular für c wirkt.
  await page.goto(`/b/${c.id}/${manageToken(c.id, 1)}`)
  const acceptC = await readForm(page, 'form:has(button:text("Angebot annehmen"))')
  expect((await submitForm(page, acceptC)).status()).toBe(303)
  expect(await statusOf(c.id)).toBe('CONFIRMED')
  // Fremder Token für dieselbe Buchung: 404, nichts passiert.
  expect((await page.goto(`/b/${a.id}/${manageToken(c.id, 1)}`))?.status()).toBe(404)
})

test('gleichzeitige Durchläufe: ein Tisch geht nur an einen Eintrag', async ({ page }) => {
  const { event } = await openEvent()
  await createBooking(event.id, ['t2'], { partySize: 8 })
  const entries = await Promise.all([waitlistEntry(event.id, 3, 30), waitlistEntry(event.id, 3, 20), waitlistEntry(event.id, 4, 10)])

  const responses = await Promise.all(Array.from({ length: 6 }, () => cron(page)))
  expect(responses.every(r => r.status() === 200)).toBe(true)
  const statuses = await Promise.all(entries.map(e => statusOf(e.id)))
  expect(statuses.filter(s => s === 'OFFERED')).toHaveLength(1)
  expect(statuses[0]).toBe('OFFERED')
  expect(await prisma.allocation.count({ where: { eventId: event.id, unit: { key: 't1' } } })).toBe(1)
})

test('bestätigen per Link und austragen; Warteliste abgeschaltet: kein Eintrag, kein Angebot', async ({ page }) => {
  const { event } = await openEvent()
  await createBooking(event.id, ['t1'], { partySize: 4 })
  const email = uniqueEmail('link')
  await openWaitlistForm(page, event.slug, 2)
  await fillWaitlistForm(page, email, 2)
  await page.getByRole('button', { name: 'Auf die Warteliste setzen' }).click()
  await expect(page.getByText('erst dann stehst du auf der Warteliste')).toBeVisible()
  const link = verifyLinkOf((await waitForMail(email)).text ?? '')

  // GET bestätigt nichts.
  await page.goto(link.url)
  await expect(page.getByRole('heading', { name: 'Eintrag auf der Warteliste bestätigen' })).toBeVisible()
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: link.bookingId } })).emailVerifiedAt).toBeNull()
  await page.getByRole('button', { name: 'Eintrag bestätigen' }).click()
  await expect(page).toHaveURL(/\?waitlisted=1$/)
  await expect(page.getByText('Du stehst jetzt auf der Warteliste.')).toBeVisible()

  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Von der Warteliste austragen' }).click()
  await expect(page.getByText('Du bist von der Warteliste ausgetragen.')).toBeVisible()
  expect(await statusOf(link.bookingId)).toBe('CANCELLED')

  // Abgeschaltet: kein Hinweis auf der Seite, und ein bestätigter Eintrag bekommt kein Angebot.
  const off = await openEvent({ waitlistEnabled: false })
  const entry = await waitlistEntry(off.event.id, 3, 10)
  await page.goto(`/${off.event.slug}`)
  await createBooking(off.event.id, ['t1'], { partySize: 4 })
  await page.reload()
  await page.getByLabel('Wie viele Personen seid ihr?').fill('3')
  await expect(page.getByText('Für 3 Personen ist gerade kein passender Tisch frei.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Auf die Warteliste' })).toHaveCount(0)
  await prisma.booking.deleteMany({ where: { eventId: off.event.id, status: 'CONFIRMED' } })
  expect((await cron(page)).status()).toBe(200)
  expect(await statusOf(entry.id)).toBe('WAITLISTED')
})

test('Admin: Reihenfolge in der Liste, Tisch direkt zuweisen, Eintrag beenden; fremdes Konto nicht', async ({ page, browser }) => {
  const { owner, event } = await openEvent({ capacities: [4, 8, 4] })
  await createBooking(event.id, ['t1'], { partySize: 4 })
  await createBooking(event.id, ['t3'], { partySize: 4 })
  await createBooking(event.id, ['t2'], { partySize: 8 })
  const older = await waitlistEntry(event.id, 3, 60)
  const newer = await waitlistEntry(event.id, 6, 5)

  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/bookings`)
  await expect(page.getByTestId('booking-counts')).toContainText('2 auf der Warteliste')
  await page.goto(`/admin/events/${event.id}/bookings?status=waitlist`)
  const rows = page.getByRole('table').getByRole('row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1)).toContainText('Gruppe 3/60')
  await expect(rows.nth(2)).toContainText('Gruppe 6/5')

  // Der 8er wird frei (ohne Anstoß eines Angebots). Admin weist ihn am Nachrück-Verfahren vorbei der
  // neueren Gruppe zu - ohne Zuweisung hätte ihn auch die neuere bekommen, denn die ältere (3) passt
  // wegen der Mindestbelegung nicht an einen 8er.
  await prisma.booking.deleteMany({ where: { eventId: event.id, allocations: { some: { unit: { key: 't2' } } } } })
  await page.goto(`/admin/events/${event.id}/bookings/${newer.id}`)
  const assign = await readForm(page, 'form:has(select#assign-table)')
  // Nachgespielt von einem fremden Konto: keine Wirkung.
  const stranger = await createAccount('CREATOR')
  const strangerPage = await (await browser.newContext()).newPage()
  await login(strangerPage, stranger.email)
  expect((await submitForm(strangerPage, assign, { unitKey: 't2' })).status()).toBe(303)
  expect(await statusOf(newer.id)).toBe('WAITLISTED')

  await page.getByLabel('Tisch zuweisen').selectOption('t2')
  await page.getByRole('button', { name: 'Tisch zuweisen und bestätigen' }).click()
  await expect(page.getByText('Tisch zugewiesen, die Buchung ist bestätigt.')).toBeVisible()
  expect(await statusOf(newer.id)).toBe('CONFIRMED')
  expect(await tableOfBooking(newer.id)).toBe('t2')
  expect((await waitForMail(newer.email!)).subject).toBe('Buchung bestätigt – Testevent')
  await expect(page.getByTestId('audit-log')).toContainText('Tisch direkt zugewiesen')

  page.on('dialog', dialog => dialog.accept())
  await page.goto(`/admin/events/${event.id}/bookings/${older.id}`)
  await page.getByRole('button', { name: 'Eintrag beenden' }).click()
  await expect(page.getByText('Buchung storniert')).toBeVisible()
  expect(await statusOf(older.id)).toBe('CANCELLED')
  expect(await mailsTo(older.email!)).toHaveLength(0)
})
