import { afterEach, describe, expect, it, vi } from 'vitest'
import { continueTarget, loginRedirectIdp, mapRole, shouldAutoRedirect } from '../../app/lib/suite'
import { parseFlow } from '../../app/lib/suite-flow'

describe('mapRole (Rolle beim ersten Login über ein anderes Tool)', () => {
  it('Admin des Anbieters wird nur mit mapAdminRole Admin, sonst Creator', () => {
    expect(mapRole({ mapAdminRole: false }, 'ADMIN')).toBe('CREATOR')
    expect(mapRole({ mapAdminRole: true }, 'ADMIN')).toBe('ADMIN')
  })

  it('Moderator bleibt Moderator, alles andere wird Creator', () => {
    expect(mapRole({ mapAdminRole: true }, 'MODERATOR')).toBe('MODERATOR')
    expect(mapRole({ mapAdminRole: false }, 'CREATOR')).toBe('CREATOR')
    expect(mapRole({ mapAdminRole: true }, 'OWNER')).toBe('CREATOR')
    expect(mapRole({ mapAdminRole: true }, undefined)).toBe('CREATOR')
  })
})

describe('continueTarget (Zwischenseite /login/continue)', () => {
  it('lässt nur den eigenen Anbieter-Endpunkt durch', () => {
    expect(continueTarget('/api/suite/authorize?app=https%3A%2F%2Fa.example&state=x')).toBe('/api/suite/authorize?app=https%3A%2F%2Fa.example&state=x')
  })

  it('alles andere fällt auf den Admin-Bereich zurück', () => {
    for (const to of [undefined, null, '', '/admin/users', 'https://evil.example/api/suite/authorize?', '//evil.example/api/suite/authorize?',
      '/api/suite/authorize', '/api/suite/authorizeX?', '/api/suite/login?idp=x', '/api/suite/authorize?\\evil', '/api/suite/authorize?\nx']) {
      expect(continueTarget(to), String(to)).toBe('/admin')
    }
  })
})

describe('parseFlow (state-Cookie)', () => {
  it('liest einen gültigen Vorgang', () => {
    const flow = { state: 's', issuer: 'https://a.example', next: '/admin', mode: 'link' }
    expect(parseFlow(JSON.stringify(flow))).toEqual(flow)
  })

  it('verwirft fehlende, kaputte und unvollständige Cookies', () => {
    expect(parseFlow(undefined)).toBeNull()
    expect(parseFlow('kein json')).toBeNull()
    expect(parseFlow(JSON.stringify({ state: 's', issuer: 'https://a.example', next: '/admin', mode: 'admin' }))).toBeNull()
    expect(parseFlow(JSON.stringify({ state: 1, issuer: 'https://a.example', next: '/admin', mode: 'login' }))).toBeNull()
  })
})

describe('Konfiguration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function freshSuite(env: Record<string, string>) {
    vi.resetModules()
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    return import('../../app/lib/suite')
  }

  it('ohne SUITE_IDPS gibt es keine Anbieter (kein Login-Button), ohne Schlüssel keine Bestätigungen', async () => {
    const suite = await freshSuite({ BASE_URL: 'https://plaetze.example.de', SUITE_IDPS: '', SUITE_SIGNING_KEY: '' })
    expect(suite.getIdps()).toEqual([])
    expect(suite.getSigners()).toEqual([])
    expect(suite.selfOrigin()).toBe('https://plaetze.example.de')
  })

  it('liest SUITE_IDPS als JSON mit Einzeleinstellungen', async () => {
    const suite = await freshSuite({
      BASE_URL: 'https://plaetze.example.de',
      SUITE_IDPS: '[{"issuer":"https://rsvp.example.de","label":"rsvp-app","autoProvision":false}]'
    })
    expect(suite.getIdps()).toEqual([{ issuer: 'https://rsvp.example.de', label: 'rsvp-app', autoProvision: false, mapAdminRole: false }])
    expect(suite.issuerLabel('https://rsvp.example.de')).toBe('rsvp-app')
    expect(suite.issuerLabel('https://vote.example.de')).toBe('vote.example.de')
  })

  it('ein kaputter Schlüssel legt nur die Föderation still, nicht das Tool', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const suite = await freshSuite({ BASE_URL: 'https://plaetze.example.de', SUITE_SIGNING_KEY: 'kaputt' })
    expect(suite.getSigners()).toEqual([])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('Anzeigename: SUITE_APP_NAME, sonst "Seating"', async () => {
    expect((await freshSuite({ SUITE_APP_NAME: '' })).appName()).toBe('Seating')
    expect((await freshSuite({ SUITE_APP_NAME: 'Plätze' })).appName()).toBe('Plätze')
  })
})

describe('shouldAutoRedirect (Login-Seite direkt zum bevorzugten Anbieter)', () => {
  it('leitet beim schlichten Aufruf weiter, auch mit next', () => {
    expect(shouldAutoRedirect({}, '/admin')).toBe(true)
    expect(shouldAutoRedirect({ next: '/admin/events' }, '/admin/events')).toBe(true)
  })

  it('zeigt das Formular bei Fehler, Reset, local und unbekannten Parametern (keine Schleife nach Fehlschlag)', () => {
    for (const params of [{ error: 'sso' }, { error: 'not-linked' }, { reset: '1' }, { local: '1' }, { local: '' }, { foo: 'x' }]) {
      expect(shouldAutoRedirect(params, '/admin'), JSON.stringify(params)).toBe(false)
    }
  })

  it('nie, wenn dieses Tool selbst als Anbieter gefragt ist (keine Ketten)', () => {
    const next = '/api/suite/authorize?app=https%3A%2F%2Fa.example&state=x'
    expect(shouldAutoRedirect({ next }, next)).toBe(false)
  })
})

describe('loginRedirectIdp (SUITE_LOGIN_REDIRECT)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('ohne Variable: kein bevorzugter Anbieter', () => {
    vi.stubEnv('SUITE_LOGIN_REDIRECT', '')
    expect(loginRedirectIdp()).toBeNull()
  })

  it('nur ein Origin aus SUITE_IDPS gilt, sonst Warnung und nichts', async () => {
    vi.resetModules()
    vi.stubEnv('BASE_URL', 'https://seating.example.de')
    vi.stubEnv('SUITE_IDPS', 'https://rsvp.example.de,https://vote.example.de')
    const { loginRedirectIdp: fresh } = await import('../../app/lib/suite')
    vi.stubEnv('SUITE_LOGIN_REDIRECT', 'https://vote.example.de/')
    expect(fresh()?.issuer).toBe('https://vote.example.de')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('SUITE_LOGIN_REDIRECT', 'https://evil.example.de')
    expect(fresh()).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
