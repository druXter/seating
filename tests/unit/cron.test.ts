import { afterEach, describe, expect, it, vi } from 'vitest'

// Der Endpunkt darf bei fehlender Berechtigung die Datenbank gar nicht erst anfassen.
vi.mock('../../app/lib/prisma', () => ({
  prisma: new Proxy({}, { get: () => { throw new Error('Datenbankzugriff ohne Berechtigung') } })
}))

const { GET } = await import('../../app/api/cron/cleanup/route')

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/cleanup', () => {
  it('lehnt ab, wenn CRON_SECRET leer ist - auch mit leerem secret-Parameter', async () => {
    vi.stubEnv('CRON_SECRET', '')
    for (const url of ['http://x/api/cron/cleanup', 'http://x/api/cron/cleanup?secret=', 'http://x/api/cron/cleanup?secret=egal']) {
      expect((await GET(new Request(url))).status).toBe(401)
    }
  })

  it('lehnt ein falsches oder fehlendes Secret ab', async () => {
    vi.stubEnv('CRON_SECRET', 'richtig')
    expect((await GET(new Request('http://x/api/cron/cleanup'))).status).toBe(401)
    expect((await GET(new Request('http://x/api/cron/cleanup?secret=falsch'))).status).toBe(401)
    expect((await GET(new Request('http://x/api/cron/cleanup?secret=richti'))).status).toBe(401)
  })
})
