import { describe, expect, it } from 'vitest'
import { canCreateEvents, eventLevel, safeEqual } from '../../app/lib/permissions'
import type { CurrentUser } from '../../app/lib/auth'

describe('safeEqual', () => {
  it('vergleicht korrekt, auch bei unterschiedlicher Länge', () => {
    expect(safeEqual('geheim', 'geheim')).toBe(true)
    expect(safeEqual('geheim', 'geheiM')).toBe(false)
    expect(safeEqual('geheim', 'geheim2')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})

describe('canCreateEvents', () => {
  const user = (role: CurrentUser['role']): CurrentUser => ({ id: '1', email: 'a@b.de', name: null, role, hasPassword: true })
  it('erlaubt Admins und Creators, nicht Moderator*innen', () => {
    expect(canCreateEvents(user('ADMIN'))).toBe(true)
    expect(canCreateEvents(user('CREATOR'))).toBe(true)
    expect(canCreateEvents(user('MODERATOR'))).toBe(false)
  })
})

describe('eventLevel', () => {
  const user = (role: CurrentUser['role'], id = 'u1'): CurrentUser => ({ id, email: 'a@b.de', name: null, role, hasPassword: true })
  it('Besitzer*in und Admin sind owner, Freigabe ergibt moderator, sonst nichts', () => {
    expect(eventLevel(user('CREATOR'), { ownerId: 'u1' }, false)).toBe('owner')
    expect(eventLevel(user('ADMIN', 'x'), { ownerId: 'u1' }, false)).toBe('owner')
    expect(eventLevel(user('ADMIN', 'x'), { ownerId: null }, false)).toBe('owner')
    expect(eventLevel(user('MODERATOR', 'm'), { ownerId: 'u1' }, true)).toBe('moderator')
    expect(eventLevel(user('CREATOR', 'c'), { ownerId: 'u1' }, true)).toBe('moderator')
    expect(eventLevel(user('CREATOR', 'c'), { ownerId: 'u1' }, false)).toBeNull()
    expect(eventLevel(user('MODERATOR', 'm'), { ownerId: null }, false)).toBeNull()
  })
})
