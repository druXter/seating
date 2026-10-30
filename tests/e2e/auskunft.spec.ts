import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { createAccount, createBooking, createEventRecord, prisma, uniqueEmail } from './helpers'

// Auskunft und Löschung zu einer Adresse (Idee Q8, auskunft.js): findet ohne Groß-/Kleinschreibung, gibt keine
// Tokens oder Hashes heraus, ändert erst mit --ja etwas und nie Verwaltungskonten oder Fremdes.
const run = (...args: string[]) => JSON.parse(execFileSync('node', ['auskunft.js', ...args], { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, encoding: 'utf8' }))

test('Buchungen: Auskunft, Probe, Anonymisierung', async () => {
  const email = uniqueEmail('auskunft')
  const event = await createEventRecord(null, { status: 'OPEN', title: 'Winterball' })
  const booking = await createBooking(event.id, ['t1'], { name: 'Anna Beispiel', email: email.toUpperCase(), note: 'Fensterplatz' })
  const other = await createBooking(event.id, [], { name: 'Fremd', email: uniqueEmail('fremd') })
  const owner = await createAccount('CREATOR', { email })

  const info = run(email)
  expect(info.daten.buchungen).toHaveLength(1)
  expect(info.daten.buchungen[0]).toMatchObject({ name: 'Anna Beispiel', note: 'Fensterplatz', event: { title: 'Winterball' } })
  expect(info.daten.verwaltungskonten).toHaveLength(1)
  expect(JSON.stringify(info)).not.toMatch(/passwordHash|verifyTokenHash/)

  expect(run(email, '--loeschen')).toMatchObject({ modus: 'probe', loeschen: { buchungenAnonymisiert: 1 } })
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).name).toBe('Anna Beispiel')
  run(email, '--loeschen', '--ja')
  const anonymous = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { allocations: true } })
  expect(anonymous).toMatchObject({ name: 'Gelöscht', email: null, note: null, phone: null })
  expect(anonymous.allocations).toHaveLength(1)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: other.id } })).name).toBe('Fremd')
  expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1)
  expect(run(email).daten.buchungen).toEqual([])
})
