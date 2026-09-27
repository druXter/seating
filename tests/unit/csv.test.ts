import { describe, expect, it } from 'vitest'
import { csvCell, parseCsv, toCsv } from '../../app/lib/csv'

describe('csvCell', () => {
  it('lässt einfache Werte unverändert, leer bei null', () => {
    expect(csvCell('Erika Muster')).toBe('Erika Muster')
    expect(csvCell(4)).toBe('4')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('setzt Werte mit Trenner, Anführungszeichen oder Zeilenumbruch in Anführungszeichen', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('sagt "hallo"')).toBe('"sagt ""hallo"""')
    expect(csvCell('Zeile 1\nZeile 2')).toBe('"Zeile 1\nZeile 2"')
  })

  it('entschärft Formeln (CSV-Injection)', () => {
    expect(csvCell('=HYPERLINK("http://x","klick")')).toBe(`"'=HYPERLINK(""http://x"",""klick"")"`)
    expect(csvCell('+49 170 123')).toBe("'+49 170 123")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\t=1')).toBe("'\t=1")
    expect(csvCell('\r=1')).toBe(`"'\r=1"`)
    // Zahlen selbst sind keine Formeln.
    expect(csvCell(-1)).toBe('-1')
  })
})

describe('toCsv', () => {
  it('BOM, Semikolon, CRLF', () => {
    expect(toCsv([['Tisch', 'Name'], ['Tisch 1', 'Ä;Ö']])).toBe('﻿Tisch;Name\r\nTisch 1;"Ä;Ö"\r\n')
  })
})

describe('parseCsv', () => {
  it('liest Semikolon-CSV mit BOM und CRLF, leere Zeilen fallen weg', () => {
    expect(parseCsv('﻿Name;Gruppe\r\nErika;Muster\r\n\r\nMax;\r\n')).toEqual([['Name', 'Gruppe'], ['Erika', 'Muster'], ['Max', '']])
  })

  it('erkennt Komma und Tab als Trenner', () => {
    expect(parseCsv('Name,Gruppe\nErika,Muster')).toEqual([['Name', 'Gruppe'], ['Erika', 'Muster']])
    expect(parseCsv('Name\tGruppe\nErika\tMuster')).toEqual([['Name', 'Gruppe'], ['Erika', 'Muster']])
  })

  it('versteht Anführungszeichen mit Trenner, "" und Zeilenumbruch darin', () => {
    expect(parseCsv('Name;Notiz\n"Muster; Erika";"sagt ""hallo""\nund tschüss"')).toEqual([['Name', 'Notiz'], ['Muster; Erika', 'sagt "hallo"\nund tschüss']])
  })

  it('verträgt eine letzte Zeile ohne Umbruch und leere Eingaben', () => {
    expect(parseCsv('Name\nErika')).toEqual([['Name'], ['Erika']])
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })

  it('liest, was toCsv schreibt (bis auf den Formel-Schutz)', () => {
    const rows = [['Name', 'Notiz'], ['Erika "Eri" Muster', 'a;b\nc']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})
