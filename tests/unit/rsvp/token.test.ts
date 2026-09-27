import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MAX_TOKEN_AGE_SECONDS, createMessage, openMessage, originOf, signMessage, verifyMessage } from '../../../app/lib/rsvp/token'

const secret = 'test-secret-0123456789abcdef0123456789'
const audience = 'https://plaetze.example.test'
const now = new Date('2026-10-01T12:00:00Z')
const at = (seconds: number) => Math.floor(now.getTime() / 1000) + seconds
const seatingEventId = 'cmseatingevent00001'
const rsvpEventId = 'cmrsvpevent00000001'

function link(extra: Record<string, unknown> = {}) {
  return {
    typ: 'seat-link', aud: audience, iat: at(0), exp: at(600), seatingEventId, rsvpEventId,
    rsvpId: 'cmrsvpanswer0000001', name: ' Erika  Muster ', email: 'Erika@Example.TEST', companions: ['Max', null], ...extra
  }
}

describe('Format wie im Vertrag rsvp-app ↔ Abstimmungstool', () => {
  it('base64url(JSON).base64url(HMAC-SHA256(payloadPart))', () => {
    const token = signMessage({ a: 1 }, secret)
    const [payload, signature] = token.split('.')
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({ a: 1 })
    expect(signature).toBe(createHmac('sha256', secret).update(payload).digest('base64url'))
    expect(token).not.toMatch(/[=+/]/)
  })

  it('falsche Signatur, fremdes Secret, kaputtes Format: null', () => {
    const token = signMessage({ a: 1 }, secret)
    expect(openMessage(token, secret)).toEqual({ a: 1 })
    expect(openMessage(token, 'anderes-secret-0123456789abcdef0123')).toBeNull()
    expect(openMessage(`${token}x`, secret)).toBeNull()
    expect(openMessage(token.split('.')[0], secret)).toBeNull()
    expect(openMessage('a.b.c', secret)).toBeNull()
    const [payload] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ a: 2 })).toString('base64url')
    expect(openMessage(`${forged}.${token.split('.')[1]}`, secret)).toBeNull()
    expect(openMessage(`${payload}.`, secret)).toBeNull()
  })
})

describe('verifyMessage', () => {
  it('gültiger Link: Namen bereinigt, Adresse normalisiert', () => {
    const message = verifyMessage(signMessage(link(), secret), 'seat-link', { secret, audience, now })
    expect(message).toMatchObject({ name: 'Erika Muster', email: 'erika@example.test', companions: ['Max', null], rsvpEventId, seatingEventId })
  })

  it('lehnt falsche Art, falschen Empfänger, Ablauf und zu lange Gültigkeit ab', () => {
    const verify = (extra: Record<string, unknown>) => verifyMessage(signMessage(link(extra), secret), 'seat-link', { secret, audience, now })
    expect(verify({ typ: 'rsvp-change' })).toBeNull()
    expect(verify({ aud: 'https://andere.example.test' })).toBeNull()
    expect(verify({ exp: at(0) })).toBeNull()
    expect(verify({ exp: at(-1) })).toBeNull()
    expect(verify({ exp: at(MAX_TOKEN_AGE_SECONDS + 5) })).toBeNull()
    expect(verify({ iat: at(600) })).toBeNull()
    expect(verify({ exp: at(MAX_TOKEN_AGE_SECONDS) })).not.toBeNull()
  })

  it('lehnt ungültige Inhalte ab (ids, fehlender Name, zu viele Begleitungen)', () => {
    const verify = (extra: Record<string, unknown>) => verifyMessage(signMessage(link(extra), secret), 'seat-link', { secret, audience, now })
    expect(verify({ rsvpId: '../x' })).toBeNull()
    expect(verify({ seatingEventId: 'X' })).toBeNull()
    expect(verify({ name: '   ' })).toBeNull()
    expect(verify({ companions: Array(50).fill(null) })).toBeNull()
    expect(verify({ email: 'keine-adresse' })).toMatchObject({ email: null })
    expect(verify({ email: null })).toMatchObject({ email: null })
  })

  it('eine Nachricht der einen Art gilt nie als eine andere', () => {
    const change = createMessage('rsvp-change', {
      aud: audience, seatingEventId, rsvpEventId, rsvpId: 'cmrsvpanswer0000001', attending: false, name: '', email: null, companions: []
    }, secret, { now })
    expect(verifyMessage(change, 'rsvp-change', { secret, audience, now })).toMatchObject({ attending: false })
    expect(verifyMessage(change, 'seat-link', { secret, audience, now })).toBeNull()
    expect(verifyMessage(change, 'guest-list', { secret, audience, now })).toBeNull()
  })

  it('createMessage setzt iat und exp', () => {
    const token = createMessage('guest-list-request', { aud: audience, seatingEventId, rsvpEventId }, secret, { now, ttlSeconds: 120 })
    expect(openMessage(token, secret)).toMatchObject({ typ: 'guest-list-request', iat: at(0), exp: at(120) })
  })
})

describe('originOf', () => {
  it('Origin ohne Pfad, null bei Unsinn', () => {
    expect(originOf('https://rsvp.example.test/')).toBe('https://rsvp.example.test')
    expect(originOf('http://127.0.0.1:2527/pfad')).toBe('http://127.0.0.1:2527')
    expect(originOf('kein url')).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })
})
