import { expect, test, type Locator, type Page } from '@playwright/test'
import { manageToken } from '../../app/lib/booking-tokens'
import {
  captureAction, cookieOf, createAccount, createBooking, createEventRecord, login, prisma, tablesLayout, uniqueEmail, uniqueIp, BASE_URL,
  type CapturedAction
} from './helpers'
import { mailsTo, waitForMail } from './mail-server'

// Phase 6: Sitzordnung (Modus ASSIGNED) mit Gästeliste (von Hand, CSV) und Drag & Drop, dazu Verschieben
// von Buchungen im Plan (TABLE/SEAT). Abläufe mit Maus, Antippen und Auswahlliste; Druck und Export;
// Sicherheitsfälle (fremdes Event, fremdes Konto, veralteter Stand, falscher Modus) mit Positivkontrolle.

/** Zwei 4er-Tische und eine Reihe mit 6 Plätzen. */
function seatingLayout() {
  return {
    schemaVersion: 1, width: 2000, height: 1000, grid: 50, nextId: 4,
    elements: [
      { id: 't1', type: 'table', shape: 'round', x: 300, y: 300, rotation: 0, width: 150, height: 150, seats: 4, sides: { top: true, right: true, bottom: true, left: true }, bookable: true },
      { id: 't2', type: 'table', shape: 'round', x: 900, y: 300, rotation: 0, width: 150, height: 150, seats: 4, sides: { top: true, right: true, bottom: true, left: true }, bookable: true },
      {
        id: 'blk3', type: 'seatBlock', x: 1400, y: 750, rotation: 0, rows: 1, seatsPerRow: 6, seatSpacing: 60, rowSpacing: 90,
        rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [], omitted: [], curveRadius: 0, bookable: true
      }
    ]
  }
}

async function seatingEvent(options: { status?: 'DRAFT' | 'OPEN' } = {}) {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { layout: seatingLayout(), status: options.status })
  await prisma.event.update({ where: { id: event.id }, data: { mode: 'ASSIGNED', access: 'NONE' } })
  return { owner, event }
}

async function createParty(eventId: string, name: string, persons: string[]) {
  return prisma.booking.create({
    data: {
      eventId, status: 'CONFIRMED', source: 'ADMIN', name, email: null, partySize: persons.length,
      attendees: { create: persons.map((person, position) => ({ eventId, name: person, position })) }
    },
    include: { attendees: { orderBy: { position: 'asc' } } }
  })
}

async function seatOf(attendeeId: string): Promise<string | null> {
  const allocation = await prisma.allocation.findUnique({ where: { attendeeId }, include: { unit: true } })
  return allocation?.unit.key ?? null
}

async function seatDirectly(eventId: string, attendee: { id: string; bookingId: string }, key: string) {
  const unit = await prisma.unit.findFirstOrThrow({ where: { eventId, key } })
  await prisma.allocation.create({ data: { eventId, unitId: unit.id, bookingId: attendee.bookingId, attendeeId: attendee.id } })
}

/** Ziehen mit der Maus von der Mitte der Quelle zur Mitte des Ziels (in Schritten, wie ein Mensch). */
async function dragTo(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 2 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
}

const unit = (page: Page, key: string) => page.locator(`[data-unit-key="${key}"]`).first()
const person = (page: Page, name: string) => page.locator(`button[data-attendee="${name}"]`)
const message = (page: Page) => page.getByTestId('arrange-message')

/** Aufruf einer Plan-Aktion (Argumente als JSON im Körper) mit ausgetauschten Werten erneut abspielen. */
async function replayWith(page: Page, action: CapturedAction, replace: [string, string][] = [], cookie?: string) {
  let body = action.body.toString('utf8')
  for (const [from, to] of replace) body = body.split(from).join(to)
  return page.request.post(action.url, {
    headers: { ...action.headers, origin: BASE_URL, 'x-forwarded-for': uniqueIp(), cookie: cookie ?? await cookieOf(page) },
    data: body, maxRedirects: 0
  })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
})

test('Sitzordnung einrichten: Modus wählen, Gruppe anlegen, Gästeliste per CSV mit Vorschau', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { layout: seatingLayout() })
  await login(page, owner.email)

  await page.goto(`/admin/events/${event.id}`)
  await page.getByLabel('Art der Buchung').selectOption('ASSIGNED')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ mode: 'ASSIGNED', access: 'NONE' })
  await expect(page.getByRole('link', { name: 'Sitzordnung', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Sitzordnung', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sitzordnung' })).toBeVisible()
  await page.getByLabel('Personen (eine pro Zeile)').fill('Erika Muster\nMax Muster')
  await page.getByLabel('Name der Gruppe (optional)').fill('Familie Muster')
  await page.getByLabel('Interne Notiz (optional)').fill('vegetarisch')
  await page.getByRole('button', { name: 'Gruppe anlegen' }).click()
  await expect(page.getByText('„Familie Muster“ mit 2 Personen angelegt.')).toBeVisible()
  const family = await prisma.booking.findFirstOrThrow({ where: { eventId: event.id }, include: { attendees: { orderBy: { position: 'asc' } } } })
  expect(family).toMatchObject({ name: 'Familie Muster', status: 'CONFIRMED', source: 'ADMIN', email: null, partySize: 2, adminNote: 'vegetarisch' })
  expect(family.attendees.map(a => a.name)).toEqual(['Erika Muster', 'Max Muster'])
  await expect(page.getByTestId('party').filter({ hasText: 'Familie Muster' })).toBeVisible()

  // CSV: erst Vorschau (nichts gespeichert), dann übernehmen. Der Abschnitt bleibt dabei aufgeklappt.
  await page.getByLabel('… oder Liste einfügen').fill('Name;Gruppe;Notiz\nOma Erna;;Rollstuhl\nPaul;Freunde;\nPaula;freunde;')
  await page.getByRole('button', { name: 'Prüfen' }).click()
  await expect(page.getByTestId('import-preview')).toContainText('2 Gruppen mit 3 Personen')
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(1)
  await page.getByRole('button', { name: 'Übernehmen' }).click()
  await expect(page.getByText('2 Gruppen mit 3 Personen übernommen.')).toBeVisible()
  const friends = await prisma.booking.findFirstOrThrow({ where: { eventId: event.id, name: 'Freunde' }, include: { attendees: true } })
  expect(friends.attendees.map(a => a.name).sort()).toEqual(['Paul', 'Paula'])
  expect(await prisma.booking.findFirst({ where: { eventId: event.id, name: 'Oma Erna' } })).toMatchObject({ adminNote: 'Rollstuhl', partySize: 1 })
  await expect(page.getByTestId('seated-count')).toHaveText('0 von 5 Personen haben einen Platz.')

  // Fehlerhafte Datei: Meldung mit Zeile, nichts übernommen.
  await page.getByLabel('… oder Liste einfügen').fill('Name;Gruppe\nAnna;X\n;X')
  await page.getByRole('button', { name: 'Prüfen' }).click()
  await expect(page.getByText('Zeile 3: Name fehlt.')).toBeVisible()
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(3)

  // Keine Buchung von Hand anlegen, keine Rundmail - beides führt zur Sitzordnung.
  await page.goto(`/admin/events/${event.id}/bookings/new`)
  await expect(page).toHaveURL(new RegExp(`/admin/events/${event.id}/arrange$`))
  await page.goto(`/admin/events/${event.id}/mail`)
  await expect(page).toHaveURL(new RegExp(`/admin/events/${event.id}/arrange$`))
})

test('Mit der Maus: Person setzen, Gruppe zusammen setzen, tauschen, auf einen Tisch ziehen, vom Platz nehmen', async ({ page }) => {
  const { owner, event } = await seatingEvent()
  const family = await createParty(event.id, 'Familie Muster', ['Erika Muster', 'Max Muster'])
  const friends = await createParty(event.id, 'Freunde', ['Paul', 'Paula', 'Pia'])
  const [erika, max] = family.attendees
  const [paul, paula, pia] = friends.attendees
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/arrange`)

  await dragTo(page, person(page, 'Erika Muster'), unit(page, 't1-s1'))
  await expect(message(page)).toHaveText('Erika Muster sitzt jetzt auf Tisch 1, Platz 1.')
  expect(await seatOf(erika.id)).toBe('t1-s1')
  await expect(unit(page, 't1-s1')).toHaveAttribute('data-state', 'confirmed')

  // Ganze Gruppe ab einem Platz der Reihe: nebeneinander.
  await dragTo(page, page.getByTestId('party').filter({ hasText: 'Freunde' }).getByRole('button', { name: /zusammen setzen/ }), unit(page, 'blk3-r1-s2'))
  await expect(message(page)).toContainText('„Freunde“ sitzt jetzt zusammen')
  expect([await seatOf(paul.id), await seatOf(paula.id), await seatOf(pia.id)]).toEqual(['blk3-r1-s2', 'blk3-r1-s3', 'blk3-r1-s4'])

  // Besetzter Platz auf besetzten Platz: tauschen.
  await dragTo(page, unit(page, 't1-s1'), unit(page, 'blk3-r1-s2'))
  await expect(message(page)).toHaveText('Erika Muster und Paul haben die Plätze getauscht.')
  expect([await seatOf(erika.id), await seatOf(paul.id)]).toEqual(['blk3-r1-s2', 't1-s1'])
  // Die Familie sitzt nicht getrennt (nur Erika hat einen Platz), die Freunde schon.
  await expect(page.getByTestId('party').filter({ hasText: 'Freunde' }).getByTestId('party-split')).toContainText('getrennt: Tisch 1, Reihe A')

  // Person auf einen Tisch: erster freier Platz daran.
  await dragTo(page, person(page, 'Max Muster'), unit(page, 't2'))
  await expect(message(page)).toHaveText('Max Muster sitzt jetzt auf Tisch 2, Platz 1.')
  expect(await seatOf(max.id)).toBe('t2-s1')

  // Zurück in die Liste: vom Platz nehmen.
  await dragTo(page, unit(page, 't1-s1'), page.getByRole('region', { name: 'Gästeliste' }).getByRole('heading', { name: 'Gäste' }))
  await expect(message(page)).toHaveText('Paul hat keinen Platz mehr.')
  expect(await seatOf(paul.id)).toBeNull()
  await expect(page.getByTestId('seated-count')).toHaveText('4 von 5 Personen haben einen Platz.')

  // Gruppe passt nicht zusammen: nichts passiert, verständliche Meldung.
  const big = await createParty(event.id, 'Großfamilie', ['A', 'B', 'C', 'D', 'E'])
  await page.reload()
  await dragTo(page, page.getByTestId('party').filter({ hasText: 'Großfamilie' }).getByRole('button', { name: /zusammen setzen/ }), unit(page, 't1-s2'))
  await expect(message(page)).toContainText('keine 5 Plätze zusammen frei')
  expect(await prisma.allocation.count({ where: { bookingId: big.id } })).toBe(0)

  // Verlauf der Person steht an der Gruppe.
  await page.goto(`/admin/events/${event.id}/bookings/${family.id}`)
  await expect(page.getByTestId('audit-log')).toContainText('Platz zugewiesen')
  await expect(page.getByTestId('audit-log')).toContainText('Platz: Tisch 1, Platz 1 → Reihe A, Platz 2')
})

test('Ohne Ziehen: antippen und Ziel antippen, Platz aus der Liste wählen, Gruppe per Auswahl', async ({ page }) => {
  const { owner, event } = await seatingEvent()
  const family = await createParty(event.id, 'Familie Muster', ['Erika Muster', 'Max Muster'])
  const friends = await createParty(event.id, 'Freunde', ['Paul', 'Paula'])
  const [erika, max] = family.attendees
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/arrange`)

  await person(page, 'Erika Muster').click()
  await expect(page.getByTestId('selection')).toContainText('Ausgewählt: Erika Muster (ohne Platz)')
  await unit(page, 't2-s3').click()
  await expect(message(page)).toHaveText('Erika Muster sitzt jetzt auf Tisch 2, Platz 3.')
  expect(await seatOf(erika.id)).toBe('t2-s3')

  // Tastatur: Person wählen, Platz aus der Auswahlliste.
  await person(page, 'Max Muster').focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('Platz', { exact: true }).selectOption('t2-s4')
  await page.getByRole('button', { name: 'Hierher setzen' }).click()
  await expect(message(page)).toHaveText('Max Muster sitzt jetzt auf Tisch 2, Platz 4.')
  expect(await seatOf(max.id)).toBe('t2-s4')

  // Gruppe wählen, Startplatz aus der Liste.
  await page.getByTestId('party').filter({ hasText: 'Freunde' }).getByRole('button', { name: /zusammen setzen/ }).click()
  await page.getByLabel('Ab Platz').selectOption('t1-s4')
  await page.getByRole('button', { name: 'Hierher setzen' }).click()
  await expect(message(page)).toContainText('„Freunde“ sitzt jetzt zusammen: Tisch 1, Plätze 1, 4')
  expect((await Promise.all(friends.attendees.map(a => seatOf(a.id))))).toEqual(['t1-s4', 't1-s1'])

  // Besetzten Platz antippen wählt die Person darauf; "Vom Platz nehmen".
  await unit(page, 't2-s3').click()
  await expect(page.getByTestId('selection')).toContainText('Ausgewählt: Erika Muster (Tisch 2, Platz 3)')
  await page.getByRole('button', { name: 'Vom Platz nehmen' }).click()
  await expect(message(page)).toHaveText('Erika Muster hat keinen Platz mehr.')
  expect(await seatOf(erika.id)).toBeNull()

  // Escape bricht die Auswahl ab.
  await person(page, 'Erika Muster').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('selection')).not.toContainText('Ausgewählt')
})

test('Gruppe bearbeiten, Druck und Tischkarten, Export pro Person; öffentlich keine Namen, kein Verwaltungslink', async ({ page }) => {
  const { owner, event } = await seatingEvent({ status: 'OPEN' })
  const family = await createParty(event.id, 'Familie Muster', ['Erika Muster', 'Max Muster'])
  const [erika, max] = family.attendees
  await seatDirectly(event.id, erika, 't1-s1')
  await seatDirectly(event.id, max, 't1-s2')
  await login(page, owner.email)

  await page.goto(`/admin/events/${event.id}/bookings/${family.id}`)
  await expect(page.getByTestId('party-persons')).toContainText('Tisch 1, Platz 2')
  await page.getByLabel('Person 1', { exact: true }).fill('Erika Muster-Schmidt')
  await page.getByLabel('Max Muster entfernen').check()
  await page.getByLabel('Personen hinzufügen (eine pro Zeile)').fill('Oma Erna')
  await page.getByRole('button', { name: 'Gruppe speichern' }).click()
  await expect(page.getByText('Gruppe gespeichert.')).toBeVisible()
  const updated = await prisma.booking.findUniqueOrThrow({ where: { id: family.id }, include: { attendees: { orderBy: { position: 'asc' } } } })
  expect(updated.partySize).toBe(2)
  expect(updated.attendees.map(a => a.name)).toEqual(['Erika Muster-Schmidt', 'Oma Erna'])
  // Max ist weg - und mit ihm sein Platz.
  expect(await prisma.allocation.count({ where: { eventId: event.id } })).toBe(1)
  await expect(page.getByTestId('audit-log')).toContainText('Gruppe geändert')

  await page.goto(`/admin/events/${event.id}/print`)
  await expect(page.getByTestId('seating-row')).toHaveCount(1)
  await expect(page.getByTestId('seating-row')).toContainText('Erika Muster-Schmidt')
  await expect(page.getByText('Ohne Platz (1)')).toBeVisible()
  await page.goto(`/admin/events/${event.id}/print?view=cards`)
  await expect(page.getByTestId('table-card')).toHaveText(/Erika Muster-Schmidt\s*Tisch 1, Platz 1/)

  const csv = await (await page.request.get(`/admin/events/${event.id}/export`, { headers: { cookie: await cookieOf(page) } })).text()
  expect(csv).toContain('Platz;Name;Gruppe;Status;Interne Notiz;Angelegt am')
  expect(csv).toContain('Tisch 1, Platz 1;Erika Muster-Schmidt;Familie Muster;bestätigt')
  expect(csv).toContain(';Oma Erna;Familie Muster;bestätigt')

  // Öffentliche Seite: keine Online-Buchung, keine Namen - weder sichtbar noch im HTML.
  const visitor = await page.context().browser()!.newPage()
  const response = await visitor.goto(`${BASE_URL}/${event.slug}`)
  await expect(visitor.getByText('die Sitzordnung legen die Veranstalter*innen fest')).toBeVisible()
  const html = await response!.text()
  for (const name of ['Erika', 'Oma Erna', 'Familie Muster']) expect(html).not.toContain(name)
  // Auch ein richtig abgeleiteter Verwaltungslink öffnet nichts.
  expect((await visitor.goto(`${BASE_URL}/b/${family.id}/${manageToken(family.id, 1)}`))!.status()).toBe(404)
  await visitor.close()

  // Absagen gibt die Plätze frei, die Gruppe bleibt als abgesagt.
  await page.goto(`/admin/events/${event.id}/bookings/${family.id}`)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Gruppe hat abgesagt' }).click()
  await expect(page.getByText('Gruppe abgesagt, ihre Plätze sind wieder frei.')).toBeVisible()
  expect(await prisma.allocation.count({ where: { eventId: event.id } })).toBe(0)
})

test('Sicherheit Sitzordnung: fremdes Event, fremdes Konto, veralteter Stand, falscher Modus - mit Positivkontrolle', async ({ page }) => {
  const { owner, event } = await seatingEvent()
  const family = await createParty(event.id, 'Familie Muster', ['Erika Muster'])
  const [erika] = family.attendees
  const other = await seatingEvent()
  const stranger = (await createParty(other.event.id, 'Fremde', ['Fritz'])).attendees[0]
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/arrange`)

  await person(page, 'Erika Muster').click()
  const action = await captureAction(page, () => unit(page, 't1-s1').click())
  await expect(message(page)).toHaveText('Erika Muster sitzt jetzt auf Tisch 1, Platz 1.')

  // Veralteter Stand: Der Client glaubt, Erika habe keinen Platz - abgelehnt, sie bleibt sitzen.
  const stale = await replayWith(page, action, [['"t1-s1"', '"t1-s3"']])
  expect(await stale.text()).toContain('inzwischen geändert')
  expect(await seatOf(erika.id)).toBe('t1-s1')

  // Positivkontrolle: mit richtigem Stand geht es.
  await replayWith(page, action, [['null', '"t1-s1"'], ['"t1-s1"]', '"t1-s3"]']])
  expect(await seatOf(erika.id)).toBe('t1-s3')

  // Person aus einem fremden Event über das eigene Event: gibt es nicht.
  const foreign = await replayWith(page, action, [[erika.id, stranger.id]])
  expect(await foreign.text()).toContain('Diese Person gibt es nicht')
  expect(await seatOf(stranger.id)).toBeNull()

  // Fremdes Event direkt: kein Zugriff.
  const foreignEvent = await replayWith(page, action, [[event.id, other.event.id], [erika.id, stranger.id]])
  expect(await foreignEvent.text()).toContain('Kein Zugriff')
  expect(await seatOf(stranger.id)).toBeNull()

  // Konto ohne Freigabe: kein Zugriff; mit Freigabe (Moderator*in): erlaubt.
  const moderator = await createAccount('MODERATOR')
  const modPage = await page.context().browser()!.newPage()
  await login(modPage, moderator.email)
  const denied = await replayWith(modPage, action, [['null', '"t1-s3"'], ['"t1-s1"]', '"t2-s1"]']])
  expect(await denied.text()).toContain('Kein Zugriff')
  expect(await seatOf(erika.id)).toBe('t1-s3')
  await prisma.eventAccess.create({ data: { eventId: event.id, userId: moderator.id } })
  await replayWith(modPage, action, [['null', '"t1-s3"'], ['"t1-s1"]', '"t2-s1"]']])
  expect(await seatOf(erika.id)).toBe('t2-s1')
  await modPage.close()

  // Ohne Anmeldung: nichts passiert.
  await replayWith(page, action, [['null', '"t2-s1"'], ['"t1-s1"]', '"t2-s2"]']], '')
  expect(await seatOf(erika.id)).toBe('t2-s1')

  // Unbekannte Platzform wird abgelehnt, bevor etwas gelesen wird.
  const bad = await replayWith(page, action, [['null', '"t2-s1"'], ['"t1-s1"]', '"t2-s1\' OR 1"]']])
  expect(await bad.text()).toContain('Unbekannter Platz')

  // Falscher Modus: Dasselbe Event als Tischbuchung nimmt keine Personen an.
  await prisma.event.update({ where: { id: event.id }, data: { mode: 'TABLE', access: 'OPEN' } })
  const wrongMode = await replayWith(page, action, [['null', '"t2-s1"'], ['"t1-s1"]', '"t2-s2"]']])
  expect(await wrongMode.text()).toContain('nur bei einer Sitzordnung')
  expect(await seatOf(erika.id)).toBe('t2-s1')
})

test('Tischbuchung: Buchung per Ziehen verschieben - mit Rückfrage, Änderungsmail und Prüfungen', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: tablesLayout([4, 8, 4]) })
  const email = uniqueEmail('zieh')
  const booking = await createBooking(event.id, ['t1'], { name: 'Familie Zieh', email, partySize: 3 })
  const other = await createBooking(event.id, ['t3'], { name: 'Andere', partySize: 2 })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)
  await page.getByRole('link', { name: 'Im Plan verschieben' }).click()
  await expect(page.getByRole('heading', { name: 'Buchungen im Plan verschieben' })).toBeVisible()

  // Auf einen belegten Tisch: abgelehnt, bevor gefragt wird.
  await dragTo(page, unit(page, 't1'), unit(page, 't3'))
  await expect(message(page)).toHaveText('Tisch 3 ist belegt.')

  // Abbrechen ändert nichts.
  await dragTo(page, unit(page, 't1'), unit(page, 't2'))
  await expect(page.getByText('„Familie Zieh“ von Tisch 1 nach Tisch 2 verschieben?')).toBeVisible()
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  expect((await prisma.allocation.findFirstOrThrow({ where: { bookingId: booking.id }, include: { unit: true } })).unit.key).toBe('t1')

  const action = await captureAction(page, async () => {
    await dragTo(page, unit(page, 't1'), unit(page, 't2'))
    await expect(page.getByText('Die Kund*in bekommt eine Änderungsmail.')).toBeVisible()
    await page.getByRole('button', { name: 'Verschieben', exact: true }).click()
  })
  await expect(message(page)).toHaveText('„Familie Zieh“ verschoben.')
  expect((await prisma.allocation.findFirstOrThrow({ where: { bookingId: booking.id }, include: { unit: true } })).unit.key).toBe('t2')
  const mail = await waitForMail(email)
  expect(mail.text).toContain('Tisch 1 → Tisch 2')
  expect(await prisma.auditLog.count({ where: { bookingId: booking.id, action: 'changed' } })).toBe(1)

  // Veralteter Stand (updatedAt vor der Änderung): abgelehnt.
  const stale = await replayWith(page, action, [['"t1","t2"', '"t2","t1"']])
  expect(await stale.text()).toContain('inzwischen geändert')
  expect((await prisma.allocation.findFirstOrThrow({ where: { bookingId: booking.id }, include: { unit: true } })).unit.key).toBe('t2')

  // Fremde Buchung (anderes Event) über dieses Event: gibt es nicht.
  const foreignEvent = await createEventRecord(owner.id, { layout: tablesLayout([4, 4]) })
  const foreign = await createBooking(foreignEvent.id, ['t1'], { partySize: 2 })
  const answer = await replayWith(page, action, [[booking.id, foreign.id]])
  expect(await answer.text()).toContain('gibt es nicht')
  expect((await prisma.allocation.findFirstOrThrow({ where: { bookingId: foreign.id }, include: { unit: true } })).unit.key).toBe('t1')

  // Ohne Benachrichtigung: keine weitere Mail. Tisch zu klein: abgelehnt.
  await page.reload()
  await page.getByLabel(/Kund\*innen per Mail benachrichtigen/).uncheck()
  await dragTo(page, unit(page, 't2'), unit(page, 't1'))
  await page.getByRole('button', { name: 'Verschieben', exact: true }).click()
  await expect(message(page)).toHaveText('„Familie Zieh“ verschoben.')
  expect(await mailsTo(email)).toHaveLength(1)
  await prisma.booking.update({ where: { id: other.id }, data: { status: 'CANCELLED' } })
  await prisma.allocation.deleteMany({ where: { bookingId: other.id } })
  await prisma.booking.update({ where: { id: booking.id }, data: { partySize: 5 } })
  await page.reload()
  await dragTo(page, unit(page, 't1'), unit(page, 't3'))
  await page.getByRole('button', { name: 'Verschieben', exact: true }).click()
  await expect(message(page)).toContainText('Tisch 3 hat nur 4 Plätze')
})

test('Platzbuchung: einen Platz einer Buchung per Auswahl verschieben (ohne Maus)', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: seatingLayout() })
  await prisma.event.update({ where: { id: event.id }, data: { mode: 'SEAT' } })
  const booking = await createBooking(event.id, ['blk3-r1-s1', 'blk3-r1-s2'], { name: 'Sina Sitz', email: null, partySize: 2 })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/arrange`)

  await page.getByRole('button', { name: 'Sina Sitz: Reihe A, Platz 1 verschieben' }).click()
  await page.getByLabel('Neuer Platz').selectOption('blk3-r1-s6')
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.getByText('„Sina Sitz“ von Reihe A, Platz 1 nach Reihe A, Platz 6 verschieben?')).toBeVisible()
  await expect(page.getByText('Diese Buchung bekommt keine Mail')).toBeVisible()
  await page.getByRole('button', { name: 'Verschieben', exact: true }).click()
  await expect(message(page)).toHaveText('„Sina Sitz“ verschoben.')
  const keys = (await prisma.allocation.findMany({ where: { bookingId: booking.id }, include: { unit: true } })).map(a => a.unit.key).sort()
  expect(keys).toEqual(['blk3-r1-s2', 'blk3-r1-s6'])
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ partySize: 2 })
})
