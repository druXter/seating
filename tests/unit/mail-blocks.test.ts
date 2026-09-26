import { describe, expect, it } from 'vitest'
import { broadcastBlocks, esc, renderHtml, renderText } from '../../app/lib/mail-blocks'

const event = {
  title: 'Gala <2026>', location: 'Festsaal', startsAt: new Date('2026-12-12T18:00:00Z'), endsAt: new Date('2026-12-12T22:30:00Z'), timezone: 'Europe/Berlin'
}

describe('Rundmail-Bausteine', () => {
  it('Text, eigene Buchung und Verwaltungslink', () => {
    const text = renderText(broadcastBlocks(event, { name: 'Erika', partySize: 4 }, 'Tisch 7', 'Einlass ab 18 Uhr.', 'https://x.test/b/abc/tok'))
    expect(text).toMatch(/^Hallo,\n\nEinlass ab 18 Uhr\./)
    expect(text).toContain('Tisch: Tisch 7')
    expect(text).toContain('Personen: 4')
    expect(text).toContain('Wann: Samstag, 12. Dezember 2026, 19:00–23:30 Uhr')
    expect(text).toContain('Buchung ansehen oder ändern:\nhttps://x.test/b/abc/tok')
  })

  it('ohne Verwaltungslink (unbestätigte Buchung) kein Button', () => {
    const blocks = broadcastBlocks(event, { name: 'Erika', partySize: 4 }, 'Tisch 7', 'Hallo', null)
    expect(blocks.some(b => b.kind === 'button')).toBe(false)
  })

  it('maskiert frei wählbare Texte im HTML-Teil', () => {
    const html = renderHtml(event.title, broadcastBlocks(event, { name: '<script>alert(1)</script>', partySize: 2 }, 'Tisch "1"', 'a & b\nc', 'https://x.test/b/1/"x'))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Gala &lt;2026&gt;')
    expect(html).toContain('a &amp; b<br>c')
    expect(html).toContain('href="https://x.test/b/1/&quot;x"')
    expect(esc(`'`)).toBe('&#39;')
  })
})
