import { describe, expect, it } from 'vitest'
import {
  adminTableProblem, broadcastDelayMs, effectiveStatus, isRecipient, matchesListFilter, matchesSearch, parseAdminChange, parseAdminCreate,
  parseAdminNote, parseListFilter, parseRecipientFilter, parseUpdatedAt
} from '../../../app/lib/events/admin-rules'

const now = new Date('2026-10-01T12:00:00Z')
const later = new Date(now.getTime() + 60_000)
const earlier = new Date(now.getTime() - 60_000)

function form(entries: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) for (const v of [value].flat()) data.append(key, v)
  return data
}

describe('Status und Filter', () => {
  it('abgelaufener Hold gilt als verfallen', () => {
    expect(effectiveStatus({ status: 'PENDING', expiresAt: later }, now)).toBe('PENDING')
    expect(effectiveStatus({ status: 'PENDING', expiresAt: earlier }, now)).toBe('EXPIRED')
    expect(effectiveStatus({ status: 'CONFIRMED', expiresAt: null }, now)).toBe('CONFIRMED')
  })

  it('Filter der Liste', () => {
    expect(parseListFilter(undefined)).toBe('active')
    expect(parseListFilter('quatsch')).toBe('active')
    expect(parseListFilter('cancelled')).toBe('cancelled')
    const expired = { status: 'PENDING' as const, expiresAt: earlier }
    expect(matchesListFilter(expired, 'active', now)).toBe(false)
    expect(matchesListFilter(expired, 'expired', now)).toBe(true)
    expect(matchesListFilter(expired, 'pending', now)).toBe(false)
    expect(matchesListFilter({ status: 'CANCELLED', expiresAt: null }, 'all', now)).toBe(true)
    expect(matchesListFilter({ status: 'CONFIRMED', expiresAt: null }, 'active', now)).toBe(true)
  })

  it('Suche ohne Groß-/Kleinschreibung, mit Umlauten und Tisch', () => {
    const booking = { name: 'Jürgen Übel', email: 'j@example.test', phone: '0171 555', tables: ['Tisch 12'] }
    expect(matchesSearch(booking, '')).toBe(true)
    expect(matchesSearch(booking, 'übel')).toBe(true)
    expect(matchesSearch(booking, 'JÜRGEN')).toBe(true)
    expect(matchesSearch(booking, 'tisch 12')).toBe(true)
    expect(matchesSearch(booking, '555')).toBe(true)
    expect(matchesSearch({ ...booking, email: null }, 'example')).toBe(false)
  })
})

describe('Tischregeln für Veranstalter*innen', () => {
  it('Kapazität gilt, Mindestbelegung nicht', () => {
    expect(adminTableProblem({ label: 'Tisch 1', capacity: 8 }, 1)).toBeNull()
    expect(adminTableProblem({ label: 'Tisch 1', capacity: 8 }, 8)).toBeNull()
    expect(adminTableProblem({ label: 'Tisch 1', capacity: 8 }, 9)).toContain('nur 8 Plätze')
  })
})

describe('Formulare', () => {
  it('Ändern: Telefon nie Pflicht, Tisch-key geprüft', () => {
    expect(parseAdminChange(form({ name: 'Max', partySize: '4', unitKey: 't2' }))).toEqual({
      ok: true, input: { name: 'Max', phone: null, note: null, partySize: 4, unitKeys: ['t2'] }
    })
    const bad = parseAdminChange(form({ name: '', partySize: '0', unitKey: 't1-s2' }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors).toHaveLength(3)
  })

  it('Anlegen: E-Mail optional, Bestätigung per Mail braucht eine', () => {
    const plain = parseAdminCreate(form({ name: 'Max', partySize: '4', unitKey: 't2' }))
    expect(plain).toMatchObject({ ok: true, input: { email: null, confirm: 'direct', notify: false, adminNote: null } })
    const full = parseAdminCreate(form({ name: 'Max', partySize: '4', unitKey: 't2', email: ' Max@Example.TEST ', confirm: 'verify', notify: 'on', adminNote: 'VIP' }))
    expect(full).toMatchObject({ ok: true, input: { email: 'max@example.test', confirm: 'verify', notify: true, adminNote: 'VIP' } })
    const noMail = parseAdminCreate(form({ name: 'Max', partySize: '4', unitKey: 't2', confirm: 'verify' }))
    expect(noMail).toEqual({ ok: false, errors: ['Für eine Bestätigung per Mail braucht es eine E-Mail-Adresse.'] })
    const invalid = parseAdminCreate(form({ name: 'Max', partySize: '4', unitKey: 't2', email: 'kaputt' }))
    expect(invalid).toEqual({ ok: false, errors: ['Die E-Mail-Adresse sieht nicht gültig aus.'] })
  })

  it('Modus SEAT: Plätze statt Tisch, Personenzahl = Zahl der Plätze', () => {
    expect(parseAdminChange(form({ name: 'Max', unitKey: ['blk1-r1-s1', 'blk1-r1-s2'] }), 'SEAT')).toEqual({
      ok: true, input: { name: 'Max', phone: null, note: null, partySize: 2, unitKeys: ['blk1-r1-s1', 'blk1-r1-s2'] }
    })
    expect(parseAdminChange(form({ name: 'Max', unitKey: 't2' }), 'SEAT')).toEqual({ ok: false, errors: ['Bitte wähle mindestens einen Platz.'] })
  })

  it('interne Notiz: Steuerzeichen raus, leer = null', () => {
    expect(parseAdminNote(form({ adminNote: '  Zeile 1\r\nZeile 2\u0007 ' }))).toBe('Zeile 1\nZeile 2')
    expect(parseAdminNote(form({ adminNote: '   ' }))).toBeNull()
  })

  it('Stand (updatedAt) nur als ISO-Zeitpunkt', () => {
    expect(parseUpdatedAt('2026-10-01T12:00:00.123Z')?.toISOString()).toBe('2026-10-01T12:00:00.123Z')
    expect(parseUpdatedAt('2026-10-01')).toBeNull()
    expect(parseUpdatedAt('')).toBeNull()
  })
})

describe('Rundmail', () => {
  const confirmed = { status: 'CONFIRMED' as const, expiresAt: null, email: 'a@x.test', tableKeys: ['t1'] }
  const pending = { status: 'PENDING' as const, expiresAt: later, email: 'b@x.test', tableKeys: ['t2'] }

  it('Filter aus dem Formular', () => {
    expect(parseRecipientFilter(form({}))).toEqual({ scope: 'confirmed', tableKeys: null })
    expect(parseRecipientFilter(form({ scope: 'active', tables: 'selected', tableKey: ['t1', 't1', 'x; drop'] }))).toEqual({ scope: 'active', tableKeys: ['t1'] })
    // Tischauswahl nur, wenn "nur diese Tische" gewählt ist.
    expect(parseRecipientFilter(form({ tables: 'all', tableKey: 't1' })).tableKeys).toBeNull()
  })

  it('wer bekommt die Mail', () => {
    const onlyConfirmed = { scope: 'confirmed' as const, tableKeys: null }
    expect(isRecipient(confirmed, onlyConfirmed, now)).toBe(true)
    expect(isRecipient(pending, onlyConfirmed, now)).toBe(false)
    expect(isRecipient(pending, { scope: 'active', tableKeys: null }, now)).toBe(true)
    expect(isRecipient({ ...pending, expiresAt: earlier }, { scope: 'active', tableKeys: null }, now)).toBe(false)
    expect(isRecipient({ ...confirmed, email: null }, onlyConfirmed, now)).toBe(false)
    expect(isRecipient({ ...confirmed, status: 'CANCELLED' }, { scope: 'active', tableKeys: null }, now)).toBe(false)
    expect(isRecipient(confirmed, { scope: 'confirmed', tableKeys: ['t2'] }, now)).toBe(false)
    expect(isRecipient(confirmed, { scope: 'confirmed', tableKeys: ['t1', 't2'] }, now)).toBe(true)
  })

  it('Tempo der Warteschlange', () => {
    expect(broadcastDelayMs(undefined)).toBe(2000)
    expect(broadcastDelayMs('60')).toBe(1000)
    expect(broadcastDelayMs('100000')).toBe(100)
    expect(broadcastDelayMs('0')).toBe(2000)
    expect(broadcastDelayMs('abc')).toBe(2000)
  })
})
