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
