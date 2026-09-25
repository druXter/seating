import { randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword, validatePassword, verifyPassword } from '../../app/lib/password'

describe('hashPassword / verifyPassword', () => {
  it('erkennt das richtige Passwort und lehnt ein falsches ab', async () => {
    const hash = await hashPassword('ein langes Passwort')
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/)
    expect(hash).not.toContain('ein langes Passwort')
    expect(await verifyPassword('ein langes Passwort', hash)).toEqual({ ok: true, needsRehash: false })
    expect((await verifyPassword('ein langes passwort', hash)).ok).toBe(false)
  })

  it('erzeugt für dasselbe Passwort unterschiedliche Hashes (Salt)', async () => {
    expect(await hashPassword('gleiches Passwort')).not.toBe(await hashPassword('gleiches Passwort'))
  })

  it('meldet needsRehash für Hashes mit schwächeren Parametern', async () => {
    const salt = randomBytes(16)
    const key = scryptSync('altes Passwort', salt, 64, { N: 2 ** 14, r: 8, p: 1 })
    const old = `scrypt$${2 ** 14}$8$1$${salt.toString('base64')}$${key.toString('base64')}`
    expect(await verifyPassword('altes Passwort', old)).toEqual({ ok: true, needsRehash: true })
    // Falsches Passwort löst nie einen Rehash aus.
    expect(await verifyPassword('falsch', old)).toEqual({ ok: false, needsRehash: false })
  })

  it('lehnt kaputte oder manipulierte Hash-Strings ab, ohne zu werfen', async () => {
    for (const stored of ['', 'bcrypt$x', 'scrypt$1$8$3$AA==$AA==', `scrypt$${2 ** 21}$8$3$AA==$AA==`, 'scrypt$32768$8$3$$', 'scrypt$abc$8$3$AA==$AA==']) {
      expect(await verifyPassword('egal', stored)).toEqual({ ok: false, needsRehash: false })
    }
  })
})

describe('validatePassword', () => {
  it('verlangt Mindest- und Höchstlänge', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH - 1) + 'b')).toBeNull()
    expect(validatePassword('kurz')).toMatch(/mindestens/)
    expect(validatePassword('ab'.repeat(MAX_PASSWORD_LENGTH))).toMatch(/höchstens/)
  })

  it('lehnt naheliegende Passwörter, Wiederholungen und die eigene E-Mail ab', () => {
    expect(validatePassword('Passwort123')).toMatch(/naheliegend/)
    expect(validatePassword('xxxxxxxxxxxx')).toMatch(/wiederholten/)
    expect(validatePassword('max.muster@example.de', 'Max.Muster@example.de')).toMatch(/E-Mail/)
    expect(validatePassword('max.mustermann', 'max.mustermann@example.de')).toMatch(/E-Mail/)
    expect(validatePassword('ein ganz normaler Satz', 'max@example.de')).toBeNull()
  })
})
