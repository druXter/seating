import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bookingSecretsConfigured, codeHmac, codeMatches, hashVerifyToken, manageToken, manageTokenValid, newVerifyCode, newVerifyToken
} from '../../app/lib/booking-tokens'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

beforeEach(() => {
  vi.stubEnv('VERIFY_CODE_SECRET', A)
  vi.stubEnv('MANAGE_LINK_SECRET', B)
  vi.stubEnv('MANAGE_LINK_SECRET_PREVIOUS', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('Secrets', () => {
  it('fehlende oder zu kurze Secrets schalten das Buchen ab - ohne Rückfall', () => {
    expect(bookingSecretsConfigured()).toBe(true)
    vi.stubEnv('MANAGE_LINK_SECRET', 'zu-kurz')
    expect(bookingSecretsConfigured()).toBe(false)
    expect(() => manageToken('b1', 1)).toThrow(/MANAGE_LINK_SECRET/)
    vi.stubEnv('MANAGE_LINK_SECRET', B)
    vi.stubEnv('VERIFY_CODE_SECRET', '')
    expect(bookingSecretsConfigured()).toBe(false)
    expect(() => codeHmac('b1', '123456')).toThrow(/VERIFY_CODE_SECRET/)
  })
})

describe('Verifizierungslink', () => {
  it('32 Byte Zufall, gespeichert nur als SHA-256', () => {
    const { token, hash } = newVerifyToken()
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(hash).toBe(hashVerifyToken(token))
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(newVerifyToken().token).not.toBe(token)
  })
})

describe('Verifizierungscode', () => {
  it('6 Ziffern, HMAC mit Secret und Buchungs-id, Vergleich tolerant gegenüber Leerzeichen', () => {
    const { code, hmac } = newVerifyCode('b1')
    expect(code).toMatch(/^\d{6}$/)
    expect(codeMatches('b1', code, hmac)).toBe(true)
    expect(codeMatches('b1', `${code.slice(0, 3)} ${code.slice(3)}`, hmac)).toBe(true)
    expect(codeMatches('b2', code, hmac)).toBe(false)
    expect(codeMatches('b1', code, null)).toBe(false)
    expect(codeMatches('b1', 'abcdef', hmac)).toBe(false)
  })

  it('ist kein reiner Hash: anderes Secret, anderer Wert', () => {
    const first = codeHmac('b1', '123456')
    vi.stubEnv('VERIFY_CODE_SECRET', 'c'.repeat(40))
    expect(codeHmac('b1', '123456')).not.toBe(first)
  })
})

describe('Verwaltungslink', () => {
  it('abgeleitet aus id und Version, neue Version entwertet den alten Link', () => {
    const token = manageToken('b1', 1)
    expect(manageToken('b1', 1)).toBe(token)
    expect(manageTokenValid('b1', 1, token)).toBe(true)
    expect(manageTokenValid('b1', 2, token)).toBe(false)
    expect(manageTokenValid('b2', 1, token)).toBe(false)
    expect(manageTokenValid('b1', 1, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBe(false)
    expect(manageTokenValid('b1', 1, '')).toBe(false)
  })

  it('Schlüsselrotation: alte Links gelten mit MANAGE_LINK_SECRET_PREVIOUS weiter', () => {
    const old = manageToken('b1', 1)
    vi.stubEnv('MANAGE_LINK_SECRET', 'd'.repeat(40))
    expect(manageTokenValid('b1', 1, old)).toBe(false)
    vi.stubEnv('MANAGE_LINK_SECRET_PREVIOUS', B)
    expect(manageTokenValid('b1', 1, old)).toBe(true)
    expect(manageTokenValid('b1', 1, manageToken('b1', 1))).toBe(true)
  })
})
