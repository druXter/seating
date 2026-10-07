import { expect, test } from '@playwright/test'
import { createMessage } from '../../app/lib/rsvp/token'
import { BASE_URL, createAccount, createEventRecord, login, prisma, tablesLayout, uniqueIp } from './helpers'
import { TEST_RSVP_SECRET } from './rsvp-server'

// Sitzordnung mit Namen für Gäste (Event.guestSeatingVisible, Idee L10 der Suite): nur Modus ASSIGNED, nur
// über den signierten Link aus rsvp-app, nur veröffentlichte Events - und nie auf der öffentlichen Seite.

let counter = 0
const rid = (prefix: string) => `c${prefix}${Date.now().toString(36)}${(++counter).toString(36)}`.padEnd(20, '0').slice(0, 30)

async function weddingEvent(options: { visible?: boolean; status?: 'OPEN' | 'DRAFT' } = {}) {
  const owner = await createAccount('CREATOR')
  const created = await createEventRecord(owner.id, { status: options.status ?? 'OPEN', layout: tablesLayout([2, 2]) })
  const rsvpEventId = rid('ev')
  const event = await prisma.event.update({
    where: { id: created.id }, data: { mode: 'ASSIGNED', access: 'NONE', rsvpEventId, guestSeatingVisible: options.visible ?? true }
  })
  const seats = await prisma.unit.findMany({ where: { eventId: event.id, kind: 'SEAT' }, orderBy: { key: 'asc' } })
  return { owner, event, seats }
}

/** Gruppe mit Personen und Plätzen direkt in der Datenbank (wie nach Abgleich und Platzierung). */
async function party(eventId: string, name: string, persons: { name: string; unitId: string | null }[], externalRef: string | null) {
  const booking = await prisma.booking.create({
    data: { eventId, status: 'CONFIRMED', source: externalRef ? 'RSVP' : 'ADMIN', name, partySize: persons.length, externalRef, adminNote: 'geheime Notiz' }
  })
  for (const [position, person] of persons.entries()) {
    const attendee = await prisma.attendee.create({ data: { eventId, bookingId: booking.id, name: person.name, position } })
    if (person.unitId) await prisma.allocation.create({ data: { eventId, bookingId: booking.id, unitId: person.unitId, attendeeId: attendee.id } })
  }
  return booking
}

function seatLink(event: { id: string; rsvpEventId: string | null }, rsvpId: string, name: string): string {
  const token = createMessage('seat-link', {
    aud: new URL(BASE_URL).origin, seatingEventId: event.id, rsvpEventId: event.rsvpEventId!, rsvpId, name, email: null, companions: []
  }, TEST_RSVP_SECRET)
  return `/rsvp/${event.id}?t=${token}`
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
})

test('Gast mit Zusage sieht den eigenen Platz und die Tische mit Namen - nur Namen und Plätze', async ({ page }) => {
  const { event, seats } = await weddingEvent()
  const rsvpId = rid('rs')
  await party(event.id, 'Familie Muster', [{ name: 'Erika Muster', unitId: seats[0].id }, { name: 'Max Muster', unitId: seats[1].id }], `rsvp:${event.rsvpEventId}:${rsvpId}`)
  await party(event.id, 'Kollegium', [{ name: 'Kim Kollegin', unitId: seats[2].id }, { name: 'Ohne Platz', unitId: null }], null)

  await page.goto(seatLink(event, rsvpId, 'Erika Muster'))
  await expect(page.getByTestId('own-seats')).toContainText('Eure Plätze')
  await expect(page.getByTestId('own-seats')).toContainText('Erika Muster')
  await expect(page.getByTestId('guest-seating-group')).toHaveCount(2)
  await expect(page.getByTestId('guest-seating-group').filter({ hasText: 'Kim Kollegin' })).toBeVisible()
  const html = await page.content()
  for (const hidden of ['Familie Muster', 'Kollegium', 'geheime Notiz', 'Ohne Platz']) expect(html, hidden).not.toContain(hidden)
})

test('aus, Entwurf, ungültiger Link oder öffentliche Seite: keine Namen', async ({ page, browser }) => {
  for (const options of [{ visible: false }, { status: 'DRAFT' as const }]) {
    const { event, seats } = await weddingEvent(options)
    const rsvpId = rid('rs')
    await party(event.id, 'Familie', [{ name: 'Geheime Person', unitId: seats[0].id }], `rsvp:${event.rsvpEventId}:${rsvpId}`)
    await page.goto(seatLink(event, rsvpId, 'Gast selbst'))
    await expect(page.getByText('die Sitzordnung legen die Veranstalter*innen fest'), JSON.stringify(options)).toBeVisible()
    expect(await page.content()).not.toContain('Geheime Person')
  }

  const { event, seats } = await weddingEvent()
  const rsvpId = rid('rs')
  await party(event.id, 'Familie', [{ name: 'Geheime Person', unitId: seats[0].id }], `rsvp:${event.rsvpEventId}:${rsvpId}`)
  // Positivkontrolle mit gültigem Link
  await page.goto(seatLink(event, rsvpId, 'Gast selbst'))
  await expect(page.getByTestId('guest-seating-group')).toContainText('Geheime Person')

  const visitor = await browser.newPage()
  await visitor.goto(`${BASE_URL}/rsvp/${event.id}?t=kaputt.kaputt`)
  await expect(visitor.getByText('Dieser Link ist ungültig oder abgelaufen.')).toBeVisible()
  await visitor.goto(`${BASE_URL}/${event.slug}`)
  await expect(visitor.getByText('die Sitzordnung legen die Veranstalter*innen fest')).toBeVisible()
  expect(await visitor.content()).not.toContain('Geheime Person')
  await visitor.close()
})

test('Schalter in den Einstellungen speichern', async ({ page }) => {
  const { owner, event } = await weddingEvent({ visible: false })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  await page.getByLabel(/Sitzordnung mit Namen für Gäste mit Zusage zeigen/).check()
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).guestSeatingVisible).toBe(true)
})
