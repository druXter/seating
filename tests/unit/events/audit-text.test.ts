import { describe, expect, it } from 'vitest'
import { actorText, auditDetails, auditText } from '../../../app/lib/events/audit-text'

const context = {
  accountEmail: (id: string) => (id === 'u1' ? 'orga@example.test' : null),
  tableLabel: (key: string) => ({ t1: 'Tisch 1', t3: 'Tisch 3' })[key] ?? `${key} (gelöscht)`
}
const entry = (action: string, diff: unknown, actor = 'u1') => ({ actor, action, diff, createdAt: new Date() })

describe('Audit-Log lesbar', () => {
  it('wer', () => {
    expect(actorText('customer', context)).toBe('Kund*in')
    expect(actorText('system', context)).toBe('System')
    expect(actorText('u1', context)).toBe('orga@example.test')
    expect(actorText('weg', context)).toBe('gelöschtes Konto')
  })

  it('Änderung mit Tischnamen und Benachrichtigung', () => {
    const e = entry('changed', { table: { from: 't1', to: 't3' }, partySize: { from: 4, to: 6 }, notified: true })
    expect(auditText(e)).toBe('geändert')
    expect(auditDetails(e, context)).toEqual(['Tisch: Tisch 1 → Tisch 3', 'Personenzahl: 4 → 6', 'Kund*in benachrichtigt'])
  })

  it('gelöschte Einheit, E-Mail-Korrektur, Frist, gelöschte Buchung, Rundmail', () => {
    expect(auditDetails(entry('cancelled', { table: 't9', notified: false }), context)).toEqual(['Tisch: t9 (gelöscht)', 'ohne Mail'])
    expect(auditDetails(entry('email-corrected', { email: { from: 'a@x.test', to: 'b@x.test' }, renewedExpiry: true }), context))
      .toEqual(['E-Mail: a@x.test → b@x.test', 'Frist neu begonnen'])
    expect(auditDetails(entry('deleted', { table: 't1', partySize: 4, status: 'CONFIRMED', notified: false }), context))
      .toEqual(['Tisch: Tisch 1', 'Personenzahl: 4', 'ohne Mail'])
    expect(auditDetails(entry('broadcast', { subject: 'Info', recipients: 12 }), context)).toEqual(['Betreff: Info', 'Empfänger*innen: 12'])
  })

  it('unbekannte Aktion und kaputter diff stürzen nicht ab', () => {
    expect(auditText(entry('neu', {}))).toBe('neu')
    expect(auditDetails(entry('changed', null), context)).toEqual([])
    expect(auditDetails(entry('changed', [1, 2]), context)).toEqual([])
  })
})
