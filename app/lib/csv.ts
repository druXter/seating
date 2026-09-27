// app/lib/csv.ts

/**
 * CSV für Excel/LibreOffice in deutscher Einstellung: Semikolon als Trenner, CRLF, UTF-8 mit BOM
 * (sonst zeigt Excel Umlaute falsch an).
 *
 * Formel-Schutz (CSV-Injection): Buchende tragen Namen und Anmerkungen selbst ein. Beginnt eine Zelle
 * mit = + - @, Tab oder Wagenrücklauf, würde eine Tabellenkalkulation sie als Formel ausführen - davor
 * kommt deshalb ein Apostroph (Empfehlung von OWASP).
 */

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return '﻿' + rows.map(row => row.map(csvCell).join(';')).join('\r\n') + '\r\n'
}

/**
 * Liest CSV (Gästeliste, app/lib/events/assign-rules.ts). Trenner aus der ersten Zeile erkannt
 * (Semikolon wie beim deutschen Excel, sonst Komma oder Tab), Felder in Anführungszeichen mit ""
 * als Anführungszeichen darin, Zeilenumbrüche in Anführungszeichen erlaubt, BOM am Anfang entfernt.
 * Leere Zeilen fallen weg; Zellen werden nicht getrimmt (das macht der Aufrufer).
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(input)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = () => {
    row.push(cell)
    if (row.some(value => value.trim() !== '')) rows.push(row)
    row = []
    cell = ''
  }
  while (i < input.length) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
      } else {
        cell += char
      }
      i++
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\r' || char === '\n') {
      endRow()
      if (char === '\r' && input[i + 1] === '\n') i++
    } else cell += char
    i++
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (d: string) => firstLine.split(d).length - 1
  const candidates = [';', ',', '\t'].map(d => ({ d, n: count(d) })).sort((a, b) => b.n - a.n)
  return candidates[0].n > 0 ? candidates[0].d : ';'
}
