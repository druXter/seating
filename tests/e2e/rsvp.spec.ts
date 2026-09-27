import { expect, test, type Page } from '@playwright/test'
import { createMessage } from '../../app/lib/rsvp/token'
import { manageToken } from '../../app/lib/booking-tokens'
import {
  BASE_URL, captureAction, cookieOf, createAccount, createEventRecord, login, prisma, tablesLayout, uniqueEmail, uniqueIp, withField
} from './helpers'
import { waitForMail } from './mail-server'
import { TEST_RSVP_SECRET, placementsOf, setGuestList, waitForPlacements, type TestGuest } from './rsvp-server'

// Phase 7: Anbindung an rsvp-app. A) Platzwahl über eine Zusage (Zugang RSVP): signierter Link, GET
// ändert nichts, Buchung per POST, eine Buchung pro Zusage, Verwaltungslink mit fester Personenzahl,
// Webhook (Absage storniert, Änderung wird übernommen), Rückmeldung der Platzierungen. B) Sitzordnung:
// Abgleich der Gästeliste mit Vorschau und Auswahl. Sicherheitsfälle jeweils mit Positivkontrolle.

const SEATING_ORIGIN = new URL(BASE_URL).origin
let counter = 0
/** Eindeutige cuid-artige id (rsvp-Event, Zusage). */
function rid(prefix: string): string {
  counter++
  return `c${prefix}${Date.now().toString(36)}${counter.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(20, '0').slice(0, 30)
}

async function rsvpEvent(options: { mode?: 'TABLE' | 'SEAT' | 'ASSIGNED'; layout?: object; access?: 'OPEN' | 'RSVP' | 'NONE' } = {}) {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: options.layout ?? tablesLayout([2, 4, 6]) })
  const mode = options.mode ?? 'TABLE'
  const rsvpEventId = rid('ev')
  const updated = await prisma.event.update({
    where: { id: event.id }, data: { mode, access: options.access ?? (mode === 'ASSIGNED' ? 'NONE' : 'RSVP'), rsvpEventId }
  })
  return { owner, event: updated, rsvpEventId }
}

type LinkOptions = { seatingEventId?: string; rsvpEventId?: string; aud?: string; ttlSeconds?: number; now?: Date; secret?: string }

function seatLink(event: { id: string; rsvpEventId: string | null }, guest: TestGuest, options: LinkOptions = {}): string {
  const token = createMessage('seat-link', {
    aud: options.aud ?? SEATING_ORIGIN, seatingEventId: options.seatingEventId ?? event.id, rsvpEventId: options.rsvpEventId ?? event.rsvpEventId!, ...guest
  }, options.secret ?? TEST_RSVP_SECRET, { ttlSeconds: options.ttlSeconds, now: options.now })
  return `/rsvp/${event.id}?t=${token}`
}

async function webhook(page: Page, event: { id: string; rsvpEventId: string | null }, change: { rsvpId: string; attending: boolean; name?: string; email?: string | null; companions?: (string | null)[] }, options: LinkOptions = {}) {
  const body = createMessage('rsvp-change', {
    aud: options.aud ?? SEATING_ORIGIN, seatingEventId: options.seatingEventId ?? event.id, rsvpEventId: options.rsvpEventId ?? event.rsvpEventId!,
    rsvpId: change.rsvpId, attending: change.attending, name: change.name ?? '', email: change.email ?? null, companions: change.companions ?? []
  }, options.secret ?? TEST_RSVP_SECRET, { now: options.now })
  return page.request.post('/api/rsvp-webhook', { headers: { 'Content-Type': 'text/plain', 'x-forwarded-for': uniqueIp() }, data: body })
}

function guest(name: string, companions: (string | null)[] = [], email: string | null = null): TestGuest {
  return { rsvpId: rid('rs'), name, email, companions }
}

async function bookingsOf(eventId: string) {
  return prisma.booking.findMany({ where: { eventId }, include: { allocations: { include: { unit: true } }, attendees: { orderBy: { position: 'asc' } } } })
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() })
})

test('Einstellungen: Zugang „nur mit Zusage“ braucht die rsvp-Event-ID, zeigt den Sitzplatz-Link; öffentlich keine Buchung', async ({ page }) => {
  const owner = await createAccount('CREATOR')
  const event = await createEventRecord(owner.id, { status: 'OPEN', layout: tablesLayout([4]) })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}`)

  await page.getByLabel(/Wer darf buchen/).selectOption('RSVP')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('Für den Zugang „nur mit Zusage“ braucht es die rsvp-app-Event-ID.')).toBeVisible()

  // Nach einer Fehlermeldung setzt React das Formular auf die gespeicherten Werte zurück - neu wählen.
  await page.getByLabel(/Wer darf buchen/).selectOption('RSVP')
  await page.getByLabel(/rsvp-app-Event-ID/).fill('Nicht gültig!')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText(/bitte die id des Termins aus rsvp-app einfügen/)).toBeVisible()

  const rsvpEventId = rid('ev')
  await page.getByLabel(/Wer darf buchen/).selectOption('RSVP')
  await page.getByLabel(/rsvp-app-Event-ID/).fill(rsvpEventId)
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ access: 'RSVP', rsvpEventId })
  await expect(page.getByLabel(/Sitzplatz-Link/)).toHaveValue(`${SEATING_ORIGIN}/rsvp/${event.id}`)
  await expect(page.getByTestId('access-rsvp')).toBeVisible()

  const visitor = await page.context().browser()!.newPage()
  await visitor.goto(`${BASE_URL}/${event.slug}`)
  await expect(visitor.getByText('Plätze wählst du über „Sitzplatz wählen“ bei deiner Zusage in rsvp-app.')).toBeVisible()
  await expect(visitor.getByRole('button', { name: /buchen/i })).toHaveCount(0)
  await visitor.close()

  // Verknüpfung wechseln, solange Buchungen aus Zusagen aktiv sind: abgelehnt.
  await prisma.booking.create({ data: { eventId: event.id, status: 'CONFIRMED', source: 'RSVP', name: 'X', partySize: 1, externalRef: `rsvp:${rsvpEventId}:${rid('rs')}` } })
  await page.getByLabel(/rsvp-app-Event-ID/).fill(rid('ev'))
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText(/aktive Buchung\(en\) bzw\. Gruppe\(n\) stammen aus dem bisher verknüpften rsvp-Event/)).toBeVisible()
})

test('Tischwahl über eine Zusage: GET ändert nichts, Buchung per POST, Mail, Rückmeldung an rsvp-app, erneuter Link öffnet die Buchung', async ({ page }) => {
  const { event, rsvpEventId } = await rsvpEvent()
  const email = uniqueEmail('zusage')
  const erika = guest('Erika Muster', ['Max Muster'], email)
  await page.goto(seatLink(event, erika))
  await expect(page.getByText(/Hallo Erika Muster, du hast in rsvp-app für 2 Personen zugesagt \(mit Max Muster\)/)).toBeVisible()
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(0)

  // Passend sind der 2er- und der 4er-Tisch (keine Mindestbelegung), der 6er auch.
  await expect(page.getByRole('radio')).toHaveCount(3)
  await page.locator('[data-unit-key="t2"]').first().click()
  await expect(page.getByRole('radio', { name: 'Tisch 2 (4 Plätze)' })).toBeChecked()
  await page.getByRole('button', { name: 'Tisch 2 buchen' }).click()
  await expect(page).toHaveURL(/\/b\/[a-z0-9]+\/[\w-]+\?confirmed=1$/)
  await expect(page.getByText('Deine Buchung ist bestätigt.')).toBeVisible()
  await expect(page.getByText('deine Zusage in rsvp-app')).toBeVisible()

  const [booking] = await bookingsOf(event.id)
  expect(booking).toMatchObject({
    status: 'CONFIRMED', source: 'RSVP', name: 'Erika Muster', email, partySize: 2, rsvpPartySize: 2, externalRef: `rsvp:${rsvpEventId}:${erika.rsvpId}`
  })
  expect(booking.allocations.map(a => a.unit.key)).toEqual(['t2'])
  const mail = await waitForMail(email)
  expect(mail.subject).toMatch(/bestätigt/i)
  await waitForPlacements(rsvpEventId, p => p.some(x => x.rsvpId === erika.rsvpId && x.label === 'Tisch 2'))

  // Derselbe (oder ein neuer) Link führt zur bestehenden Buchung - keine zweite.
  await page.goto(seatLink(event, erika))
  await expect(page).toHaveURL(new RegExp(`/b/${booking.id}/`))
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(1)

  // Verwaltungsseite: Name und Personenzahl sind fest, Tischwechsel geht.
  await expect(page.getByLabel('Personen')).toHaveCount(0)
  await page.getByLabel('Tisch', { exact: true }).selectOption('t3')
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  await waitForPlacements(rsvpEventId, p => p.some(x => x.rsvpId === erika.rsvpId && x.label === 'Tisch 3'))
})

test('Platzwahl über eine Zusage (SEAT): genau N Plätze; Änderung der Begleitung per Webhook, dann Plätze anpassen', async ({ page }) => {
  const layout = {
    schemaVersion: 1, width: 1600, height: 800, grid: 50, nextId: 2,
    elements: [{
      id: 'blk1', type: 'seatBlock', x: 800, y: 400, rotation: 0, rows: 1, seatsPerRow: 6, seatSpacing: 60, rowSpacing: 90,
      rowLabels: 'letters', rowStart: 1, numbering: 'ltr', seatStart: 1, aisles: [], omitted: [], curveRadius: 0, bookable: true
    }]
  }
  const { event, rsvpEventId } = await rsvpEvent({ mode: 'SEAT', layout })
  const pia = guest('Pia', ['Paul'], null)
  await page.goto(seatLink(event, pia))
  await page.getByLabel('Wie viele Plätze nebeneinander?').fill('2')
  await page.getByRole('button', { name: 'Plätze vorschlagen' }).click()
  const book = captureAction(page, () => page.getByRole('button', { name: '2 Plätze buchen' }).click())
  const action = await book
  await expect(page).toHaveURL(/\?confirmed=1$/)
  await expect(page.getByText('Speichere dir diese Seite')).toBeVisible()
  const [booking] = await bookingsOf(event.id)
  expect(booking.allocations.map(a => a.unit.key).sort()).toEqual(['blk1-r1-s1', 'blk1-r1-s2'])

  // Derselbe Aufruf noch einmal: keine zweite Buchung.
  await page.request.post(action.url, { headers: { ...action.headers, origin: BASE_URL, 'x-forwarded-for': uniqueIp() }, data: action.body })
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(1)

  // Begleitung dazu in rsvp-app: Buchung wird markiert, Verwaltungsseite verlangt 3 Plätze.
  expect((await webhook(page, event, { rsvpId: pia.rsvpId, attending: true, name: 'Pia', companions: ['Paul', 'Paula'] })).status()).toBe(200)
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ partySize: 2, rsvpPartySize: 3 })
  await page.goto(`/b/${booking.id}/${manageToken(booking.id, 1)}`)
  await expect(page.getByText('In rsvp-app hast du jetzt 3 Personen angegeben, gebucht sind 2.')).toBeVisible()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Bitte wähle genau 3 Plätze')).toBeVisible()
  await page.locator('[data-unit-key="blk1-r1-s3"]').click()
  await page.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(page.getByText('Änderungen gespeichert.')).toBeVisible()
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ partySize: 3, rsvpPartySize: 3 })
  await waitForPlacements(rsvpEventId, p => p.some(x => x.label === 'Reihe A, Plätze 1–3'))
})

test('Webhook: Absage storniert mit Mail, ältere Meldung wird ignoriert, ungültige und fremde Meldungen wirken nicht', async ({ page }) => {
  const { event, rsvpEventId } = await rsvpEvent()
  const email = uniqueEmail('absage')
  const max = guest('Max', [], email)
  const other = await rsvpEvent()
  await page.goto(seatLink(event, max))
  await page.getByRole('radio', { name: 'Tisch 1 (2 Plätze)' }).check()
  await page.getByRole('button', { name: 'Tisch 1 buchen' }).click()
  await expect(page).toHaveURL(/\?confirmed=1$/)
  const [booking] = await bookingsOf(event.id)
  await waitForMail(email)

  // Ungültig: falsches Secret, falscher Empfänger, abgelaufen -> 401, nichts passiert.
  expect((await webhook(page, event, { rsvpId: max.rsvpId, attending: false }, { secret: 'falsches-secret-0123456789abcdefghijkl' })).status()).toBe(401)
  expect((await webhook(page, event, { rsvpId: max.rsvpId, attending: false }, { aud: 'https://andere.example.test' })).status()).toBe(401)
  expect((await webhook(page, event, { rsvpId: max.rsvpId, attending: false }, { now: new Date(Date.now() - 20 * 60 * 1000) })).status()).toBe(401)
  // Gültig signiert, aber für eine andere Verknüpfung: ohne Wirkung.
  expect((await webhook(page, event, { rsvpId: max.rsvpId, attending: false }, { rsvpEventId: other.rsvpEventId })).status()).toBe(200)
  expect((await webhook(page, event, { rsvpId: max.rsvpId, attending: false }, { seatingEventId: other.event.id })).status()).toBe(200)
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: 'CONFIRMED' })

  // Eine ältere Meldung als die, mit der gebucht wurde: ignoriert.
  expect((await webhook(page, event, { rsvpId: max.rsvpId, attending: false }, { now: new Date(Date.now() - 5 * 60 * 1000) })).status()).toBe(200)
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: 'CONFIRMED' })

  // Positivkontrolle: Absage storniert, Tisch frei, Storno-Mail, Rückmeldung ohne Platz.
  expect((await webhook(page, event, { rsvpId: max.rsvpId, attending: false })).status()).toBe(200)
  expect(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).toMatchObject({ status: 'CANCELLED' })
  expect(await prisma.allocation.count({ where: { bookingId: booking.id } })).toBe(0)
  const cancel = await waitForMail(email, 2)
  expect(cancel.subject).toMatch(/storniert/i)
  await waitForPlacements(rsvpEventId, p => !p.some(x => x.rsvpId === max.rsvpId))
  const audit = await prisma.auditLog.findFirst({ where: { bookingId: booking.id, action: 'rsvp-cancelled' } })
  expect(audit?.actor).toBe('rsvp')

  // Wieder zugesagt: neuer Link bucht neu.
  await page.goto(seatLink(event, max))
  await expect(page.getByRole('button', { name: 'Tisch wählen' })).toBeVisible()
})

test('Sicherheit Link: abgelaufen, falscher Empfänger, anderes Event, nicht verknüpft, offener Zugang, manipuliert - mit Positivkontrolle', async ({ page }) => {
  const { event } = await rsvpEvent()
  const second = await rsvpEvent()
  const erika = guest('Erika')
  const invalid = page.getByText('Dieser Link ist ungültig oder abgelaufen.')

  for (const url of [
    seatLink(event, erika, { now: new Date(Date.now() - 20 * 60 * 1000) }),
    seatLink(event, erika, { ttlSeconds: 2 * 60 * 60 }),
    seatLink(event, erika, { aud: 'https://andere.example.test' }),
    seatLink(event, erika, { secret: 'falsches-secret-0123456789abcdefghijkl' }),
    seatLink(event, erika, { rsvpEventId: second.rsvpEventId }),
    seatLink(event, erika).replace(`/rsvp/${event.id}`, `/rsvp/${second.event.id}`),
    `/rsvp/${event.id}`,
    `/rsvp/${event.id}?t=kaputt`
  ]) {
    await page.goto(url)
    await expect(invalid, url).toBeVisible()
  }
  // Offener Zugang: ein sonst gültiger Link zeigt nur den Hinweis, keine Platzwahl (Buchen: siehe unten).
  await prisma.event.update({ where: { id: second.event.id }, data: { access: 'OPEN' } })
  await page.goto(seatLink(second.event, erika))
  await expect(page.getByText('werden die Plätze hier frei gebucht')).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)

  // Header der Einstiegsseite: nicht einbettbar, nicht zwischengespeichert, kein Referer.
  const response = await page.goto(seatLink(event, erika))
  expect(response!.headers()).toMatchObject({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' })

  // Buchungsaufruf mitschneiden (bucht für Paul), dann mit anderem Token nachspielen.
  const paul = guest('Paul', ['Paula'])
  await page.goto(seatLink(event, paul))
  await page.getByRole('radio', { name: 'Tisch 1 (2 Plätze)' }).check()
  const action = await captureAction(page, () => page.getByRole('button', { name: 'Tisch 1 buchen' }).click())
  await expect(page).toHaveURL(/\?confirmed=1$/)
  const token = /name="(?:_?\d+_)?token"\r\n\r\n([^\r]+)/.exec(action.body.toString('utf8'))![1]
  const replay = (value: string, unitKey = 't2') => page.request.post(action.url, {
    headers: { ...action.headers, origin: BASE_URL, 'x-forwarded-for': uniqueIp(), cookie: '' },
    data: withField(withField(action.body, 'token', value), 'unitKey', unitKey), maxRedirects: 0
  })

  // Manipulierter Inhalt (andere Zusage, keine Begleitung) mit der alten Signatur: abgelehnt.
  const [payload, signature] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), rsvpId: rid('rs'), companions: [] })).toString('base64url')
  expect(await (await replay(`${forged}.${signature}`)).text()).toContain('abgelaufen oder ungültig')
  // Derselbe Link noch einmal: keine zweite Buchung für Paul.
  await replay(token)
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(1)

  // Offener Zugang: ein gültiger Link für dieses Event bucht auch per nachgespieltem POST nichts.
  const openToken = new URL(seatLink(second.event, guest('Offen')), BASE_URL).searchParams.get('t')!
  const openReplay = await page.request.post(action.url, {
    headers: { ...action.headers, origin: BASE_URL, 'x-forwarded-for': uniqueIp(), cookie: '' },
    data: withField(withField(withField(action.body, 'token', openToken), 'eventId', second.event.id), 'unitKey', 't1'), maxRedirects: 0
  })
  expect(await openReplay.text()).toContain('abgelaufen oder ungültig')
  expect(await prisma.booking.count({ where: { eventId: second.event.id } })).toBe(0)

  // Positivkontrolle: ein gültiger Link einer anderen Zusage bucht - zweimal gleichzeitig nur einmal.
  const lena = guest('Lena', ['Luis'])
  const lenaToken = new URL(seatLink(event, lena), BASE_URL).searchParams.get('t')!
  await Promise.all([replay(lenaToken), replay(lenaToken)])
  const bookings = await bookingsOf(event.id)
  expect(bookings.map(b => [b.name, b.partySize, b.status, b.allocations.map(a => a.unit.key).join()]).sort()).toEqual([
    ['Lena', 2, 'CONFIRMED', 't2'], ['Paul', 2, 'CONFIRMED', 't1']
  ])
})

test('Link zu einem Event ohne Platzwahl über Zusagen: Hinweis statt „ungültig“ - aber nur mit gültigem Link', async ({ page }) => {
  const erika = guest('Erika', ['Emil'])
  const invalid = page.getByText('Dieser Link ist ungültig oder abgelaufen.')

  // Sitzordnung: Die Veranstalter*innen setzen die Plätze.
  const { event: assigned } = await rsvpEvent({ mode: 'ASSIGNED' })
  await page.goto(seatLink(assigned, erika))
  await expect(page.getByText('Hallo Erika, die Sitzordnung legen die Veranstalter*innen fest')).toBeVisible()
  await expect(page.getByText('Dein Platz erscheint bei deiner Zusage in rsvp-app')).toBeVisible()
  await expect(invalid).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(0)

  // Offener Zugang: Verweis auf die öffentliche Seite - ohne Link, solange sie nicht sichtbar ist.
  const { event: open } = await rsvpEvent({ access: 'OPEN' })
  await page.goto(seatLink(open, erika))
  await expect(page.getByText('werden die Plätze hier frei gebucht')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Seite der Veranstaltung' })).toHaveAttribute('href', `/${open.slug}`)
  await prisma.event.update({ where: { id: open.id }, data: { status: 'DRAFT' } })
  await page.goto(seatLink(open, erika))
  await expect(page.getByText('Die Buchung ist gerade nicht geöffnet.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Seite der Veranstaltung' })).toHaveCount(0)

  // Ungültige Links verraten weder Modus noch Zugang: dieselbe Meldung wie überall.
  const other = await rsvpEvent({ mode: 'ASSIGNED' })
  for (const [target, url] of [
    [assigned, seatLink(assigned, erika, { secret: 'falsches-secret-0123456789abcdefghijkl' })],
    [assigned, seatLink(assigned, erika, { rsvpEventId: other.rsvpEventId })],
    [assigned, seatLink(assigned, erika, { now: new Date(Date.now() - 20 * 60 * 1000) })],
    [open, seatLink(open, erika, { aud: 'https://andere.example.test' })],
    [open, `/rsvp/${open.id}?t=kaputt`]
  ] as const) {
    await page.goto(url)
    await expect(invalid, `${target.mode} ${url}`).toBeVisible()
    await expect(page.getByText('Hallo Erika')).toHaveCount(0)
  }
  // Nicht (mehr) verknüpft: ebenfalls ungültig.
  await prisma.event.update({ where: { id: assigned.id }, data: { rsvpEventId: null } })
  await page.goto(seatLink({ id: assigned.id, rsvpEventId: other.rsvpEventId }, erika))
  await expect(invalid).toBeVisible()

  // Positivkontrolle: Zugang „nur mit Zusage“ zeigt die Platzwahl.
  const { event: rsvp } = await rsvpEvent()
  await page.goto(seatLink(rsvp, erika))
  await expect(page.getByText('Wähle einen passenden Tisch.')).toBeVisible()
  await expect(page.getByRole('radio', { name: /Tisch 2/ })).toBeVisible()
})

test('Sitzordnung: Gästeliste mit rsvp-app abgleichen - neu, geändert, abgesagt nur nach Auswahl; Rückmeldung der Plätze', async ({ page }) => {
  const layout = tablesLayout([4, 4])
  const { owner, event, rsvpEventId } = await rsvpEvent({ mode: 'ASSIGNED', layout })
  const erika = guest('Erika', ['Max'])
  const oma = guest('Oma Erna')
  const paul = guest('Paul', [null])
  setGuestList(rsvpEventId, [erika, oma, paul])
  // Eine von Hand angelegte Gruppe bleibt vom Abgleich unberührt.
  await prisma.booking.create({ data: { eventId: event.id, status: 'CONFIRMED', source: 'ADMIN', name: 'Trauzeugin', partySize: 1, attendees: { create: [{ eventId: event.id, name: 'Trauzeugin', position: 0 }] } } })
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/arrange`)

  const panel = page.getByTestId('rsvp-sync')
  await panel.getByRole('button', { name: 'Mit rsvp-app abgleichen' }).click()
  await expect(panel.getByTestId('rsvp-sync-summary')).toContainText('3 Zusagen in rsvp-app.')
  await expect(panel.getByText('Neue Zusagen (3)')).toBeVisible()
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(1)
  await panel.getByRole('button', { name: 'Ausgewählte übernehmen' }).click()
  await expect(panel.getByText('3 Änderungen übernommen.')).toBeVisible()
  const parties = await bookingsOf(event.id)
  const erikaParty = parties.find(p => p.name === 'Erika')!
  expect(erikaParty).toMatchObject({ source: 'RSVP', email: null, partySize: 2, externalRef: `rsvp:${rsvpEventId}:${erika.rsvpId}` })
  expect(erikaParty.attendees.map(a => [a.externalKey, a.name])).toEqual([['guest', 'Erika'], ['companion-1', 'Max']])
  expect(parties.find(p => p.name === 'Paul')!.attendees.map(a => a.name)).toEqual(['Paul', 'Begleitung von Paul'])

  // Platzieren -> Rückmeldung an rsvp-app.
  await page.getByTestId('party').filter({ hasText: 'Erika' }).getByRole('button', { name: /zusammen setzen/ }).click()
  await page.getByLabel('Ab Platz').selectOption('t1-s1')
  await page.getByRole('button', { name: 'Hierher setzen' }).click()
  await expect(page.getByTestId('arrange-message')).toContainText('sitzt jetzt zusammen')
  await waitForPlacements(rsvpEventId, p => p.some(x => x.rsvpId === erika.rsvpId && x.label === 'Tisch 1, Plätze 1, 2'))

  // In rsvp-app: Max fällt weg, Oma sagt ab, Paul heißt jetzt anders. Webhook -> nur Hinweis.
  setGuestList(rsvpEventId, [{ ...erika, companions: [] }, { ...paul, name: 'Paul P.' }])
  expect((await webhook(page, event, { rsvpId: oma.rsvpId, attending: false })).status()).toBe(200)
  expect(await prisma.booking.count({ where: { eventId: event.id, status: 'CANCELLED' } })).toBe(0)
  await page.reload()
  await expect(page.getByText(/rsvp-app hat seit dem letzten Abgleich Änderungen gemeldet/)).toBeVisible()

  await panel.getByRole('button', { name: 'Mit rsvp-app abgleichen' }).click()
  await expect(panel.getByText('Geändert (2)')).toBeVisible()
  await expect(panel.getByText('entfällt: Max (Platz wird frei)')).toBeVisible()
  // Absagen sind nicht vorausgewählt - nichts wird still gelöscht.
  const removed = panel.getByRole('checkbox', { name: /Oma Erna/ })
  await expect(removed).not.toBeChecked()
  await panel.getByRole('button', { name: 'Ausgewählte übernehmen' }).click()
  await expect(panel.getByText('2 Änderungen übernommen.')).toBeVisible()
  expect(await prisma.booking.findFirstOrThrow({ where: { eventId: event.id, externalRef: { endsWith: oma.rsvpId } } })).toMatchObject({ status: 'CONFIRMED' })
  const erikaAfter = await prisma.booking.findUniqueOrThrow({ where: { id: erikaParty.id }, include: { attendees: true } })
  expect(erikaAfter).toMatchObject({ partySize: 1 })
  expect(erikaAfter.attendees.map(a => a.name)).toEqual(['Erika'])
  expect(await prisma.allocation.count({ where: { bookingId: erikaParty.id } })).toBe(1)
  expect(await prisma.booking.findFirstOrThrow({ where: { eventId: event.id, externalRef: { endsWith: paul.rsvpId } } })).toMatchObject({ name: 'Paul P.' })
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ rsvpChangedAt: null })
  await waitForPlacements(rsvpEventId, p => p.some(x => x.rsvpId === erika.rsvpId && x.label === 'Tisch 1, Platz 1'))

  // Jetzt die Absage ausdrücklich übernehmen.
  await panel.getByRole('button', { name: 'Mit rsvp-app abgleichen' }).click()
  await panel.getByRole('checkbox', { name: /Oma Erna/ }).check()
  await panel.getByRole('button', { name: 'Ausgewählte übernehmen' }).click()
  await expect(panel.getByText('1 Änderung übernommen.')).toBeVisible()
  expect(await prisma.booking.findFirstOrThrow({ where: { eventId: event.id, externalRef: { endsWith: oma.rsvpId } } })).toMatchObject({ status: 'CANCELLED' })
  expect(await prisma.booking.count({ where: { eventId: event.id, name: 'Trauzeugin', status: 'CONFIRMED' } })).toBe(1)

  // Gruppen aus rsvp-app lassen sich nicht von Hand umbenennen.
  await page.goto(`/admin/events/${event.id}/bookings/${erikaParty.id}`)
  await expect(page.getByText('Diese Gruppe kommt aus einer Zusage in rsvp-app.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gruppe speichern' })).toHaveCount(0)
})

test('Abgleich: nicht verknüpft in rsvp-app, fremdes Konto, ohne Verknüpfung in Seating', async ({ page }) => {
  const { owner, event, rsvpEventId } = await rsvpEvent({ mode: 'ASSIGNED' })
  setGuestList(rsvpEventId, null)
  await login(page, owner.email)
  await page.goto(`/admin/events/${event.id}/arrange`)
  await page.getByRole('button', { name: 'Mit rsvp-app abgleichen' }).click()
  await expect(page.getByText(/rsvp-app kennt diese Verknüpfung nicht/)).toBeVisible()

  // Aufruf mitschneiden, dann als fremdes Konto nachspielen: nichts passiert (Weiterleitung).
  setGuestList(rsvpEventId, [guest('Fremd')])
  await page.reload()
  const action = await captureAction(page, () => page.getByRole('button', { name: 'Mit rsvp-app abgleichen' }).click())
  await expect(page.getByText('Neue Zusagen (1)')).toBeVisible()
  const stranger = await createAccount('CREATOR')
  const other = await page.context().browser()!.newPage()
  await login(other, stranger.email)
  const applyBody = action.body.toString('utf8')
  const response = await other.request.post(action.url, { headers: { ...action.headers, origin: BASE_URL, cookie: await cookieOf(other) }, data: applyBody, maxRedirects: 0 })
  expect(await response.text()).not.toContain('Fremd')
  await other.close()
  expect(await prisma.booking.count({ where: { eventId: event.id } })).toBe(0)

  // Ohne Verknüpfung in Seating: kein Abgleich möglich.
  const plain = await createEventRecord(owner.id, { layout: tablesLayout([4]) })
  await prisma.event.update({ where: { id: plain.id }, data: { mode: 'ASSIGNED', access: 'NONE' } })
  await page.goto(`/admin/events/${plain.id}/arrange`)
  await expect(page.getByTestId('rsvp-sync')).toHaveCount(0)
  expect(placementsOf(rsvpEventId)).toBeNull()
})
