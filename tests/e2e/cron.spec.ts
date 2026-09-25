import { expect, test } from '@playwright/test'
import { TEST_CRON_SECRET } from '../../playwright.config'
import { createAccount, prisma } from './helpers'

test('Cron-Endpunkt lehnt fehlendes, leeres und falsches Secret ab', async ({ request }) => {
  for (const query of ['', '?secret=', '?secret=falsch', `?secret=${TEST_CRON_SECRET}x`]) {
    const response = await request.get(`/api/cron/cleanup${query}`)
    expect(response.status(), query).toBe(401)
  }
})

test('Cron-Endpunkt räumt auf: inaktive Konten (außer Admins), abgelaufene Sitzungen und Links', async ({ request }) => {
  const longAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000)
  const inactive = await createAccount('CREATOR')
  const inactiveAdmin = await createAccount('ADMIN')
  const active = await createAccount('CREATOR')
  await prisma.user.updateMany({ where: { id: { in: [inactive.id, inactiveAdmin.id] } }, data: { lastLoginAt: longAgo } })
  await prisma.user.update({
    where: { id: active.id },
    data: { resetTokenHash: 'abgelaufen-' + active.id, resetTokenExpiresAt: new Date(Date.now() - 1000) }
  })
  await prisma.session.create({ data: { tokenHash: 'alt-' + active.id, userId: active.id, expiresAt: new Date(Date.now() - 1000) } })

  const response = await request.get(`/api/cron/cleanup?secret=${TEST_CRON_SECRET}`)
  expect(response.status()).toBe(200)

  expect(await prisma.user.findUnique({ where: { id: inactive.id } })).toBeNull()
  expect(await prisma.user.findUnique({ where: { id: inactiveAdmin.id } })).not.toBeNull()
  const kept = await prisma.user.findUnique({ where: { id: active.id } })
  expect(kept?.resetTokenHash).toBeNull()
  expect(await prisma.session.count({ where: { userId: active.id } })).toBe(0)
})
