import { describe, expect, it } from 'vitest'
import { canCreateEvents, safeEqual } from '../../app/lib/permissions'
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
