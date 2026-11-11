// app/lib/form.ts

import { singleLine } from 'suite-kit/web'

/**
 * Formularwerte kommen als FormDataEntryValue (String ODER Datei) oder null - ein
 * einfaches `as string` (wie in älteren Teilen dieses Projekts) würde bei einem
 * manipulierten Request eine Datei durchlassen. Diese Helfer liefern immer einen String.
 */
// Einzeilig (`singleLine` aus suite-kit): Zeilenumbrüche und Steuerzeichen werden ein Leerzeichen - Namen, Titel und
// Orte landen in Mails. Mehrzeilige Felder (Textarea) lesen mit formText.
export function formString(formData: FormData, name: string, maxLength = 500): string {
  const value = formData.get(name)
  return typeof value === 'string' ? singleLine(value).slice(0, maxLength) : ''
}

/**
 * Mehrzeiliger Text (Textarea): wie formString, aber Zeilenumbrüche bleiben, einheitlich als \n - Browser schicken
 * Textfelder mit \r\n.
 */
export function formText(formData: FormData, name: string, maxLength = 500): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, maxLength) : ''
}

/** Wie formString, aber ohne trim() - Passwörter dürfen führende/folgende Leerzeichen enthalten. */
export function formPassword(formData: FormData, name: string): string {
  const value = formData.get(name)
  // Länger als die Obergrenze in validatePassword wird nicht abgeschnitten, sondern
  // unverändert weitergereicht und dort abgelehnt - Abschneiden würde ein anderes
  // Passwort speichern als eingegeben.
  return typeof value === 'string' && value.length <= 1000 ? value : ''
}

/** Normalisiert und prüft eine E-Mail-Adresse. Gibt null zurück, wenn sie offensichtlich ungültig ist. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}
