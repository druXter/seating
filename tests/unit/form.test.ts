import { describe, expect, it } from 'vitest'
import { formPassword, formString, normalizeEmail } from '../../app/lib/form'

describe('formString', () => {
  it('trimmt, kürzt und liefert für fehlende Felder einen leeren String', () => {
    const data = new FormData()
    data.set('name', '  Erna  ')
    data.set('long', 'x'.repeat(50))
    expect(formString(data, 'name')).toBe('Erna')
    expect(formString(data, 'long', 10)).toBe('x'.repeat(10))
    expect(formString(data, 'fehlt')).toBe('')
  })

  it('lässt keine Datei durch (manipulierter Request)', () => {
    const data = new FormData()
    data.set('name', new Blob(['inhalt']), 'datei.txt')
    expect(formString(data, 'name')).toBe('')
  })
})

describe('formPassword', () => {
  it('behält Leerzeichen und verwirft übergroße Eingaben statt sie abzuschneiden', () => {
    const data = new FormData()
    data.set('pw', '  mit Leerzeichen  ')
    data.set('huge', 'x'.repeat(1001))
    expect(formPassword(data, 'pw')).toBe('  mit Leerzeichen  ')
    expect(formPassword(data, 'huge')).toBe('')
  })
})

describe('normalizeEmail', () => {
  it('normalisiert gültige Adressen und lehnt ungültige ab', () => {
    expect(normalizeEmail('  Erna@Example.DE ')).toBe('erna@example.de')
    expect(normalizeEmail('keine-adresse')).toBeNull()
    expect(normalizeEmail('a b@example.de')).toBeNull()
    expect(normalizeEmail(`${'a'.repeat(250)}@example.de`)).toBeNull()
  })
})
