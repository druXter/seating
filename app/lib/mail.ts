// app/lib/mail.ts
import nodemailer from 'nodemailer'
import { APP_NAME } from './app'

// Gleicher Transporter-Aufbau wie in rsvp-app und im Abstimmungstool - laufen die Tools
// über dasselbe Postfach, deckt der dort abgeschlossene AVV auch diesen Versand ab.
// SMTP_HOST bewusst nicht vorausgesetzt: bleibt es leer, bricht der Versand unten früh ab
// statt einen kaputten Transporter zu nutzen. Die Konto-Funktionen funktionieren dann
// trotzdem - Einladungslinks werden dem einladenden Konto direkt auf dem Bildschirm
// angezeigt (siehe app/admin/users/page.tsx). Buchungsmails (ab Phase 3) brauchen SMTP.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export function isMailConfigured(): boolean {
  return !!process.env.SMTP_HOST
}

/** Maskiert Text für die Verwendung in HTML (Mail-Inhalte enthalten u.a. frei wählbare Namen/Titel). */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function layout(heading: string, body: string, buttonLabel: string, link: string, footer: string): string {
  return `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
        <h2>${esc(heading)}</h2>
        <p>${esc(body)}</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${esc(link)}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 5px; font-weight: bold;">${esc(buttonLabel)}</a>
        </p>
        <p style="font-size: 12px; color: #666;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${esc(link)}</p>
        <p style="font-size: 12px; color: #666;">${esc(footer)}</p>
      </div>
    `
}

async function send(toEmail: string, subject: string, text: string, html: string): Promise<boolean> {
  if (!isMailConfigured()) return false

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: toEmail,
      subject,
      text,
      html,
      envelope: { from: process.env.SMTP_USER, to: toEmail }
    })
    return true
  } catch (error) {
    console.error(`Fehler beim Senden einer Mail an ${toEmail}:`, error)
    return false
  }
}

/** Einladung zu einem neu angelegten Konto - der Link legt das erste Passwort fest. */
export async function sendInviteEmail(toEmail: string, link: string, validDays: number): Promise<boolean> {
  return send(
    toEmail,
    `Einladung zu ${APP_NAME}`,
    `Hallo,

für dich wurde ein Konto bei ${APP_NAME} angelegt. Lege mit diesem Link dein Passwort fest (${validDays} Tage gültig, nur einmal nutzbar):
${link}

Falls du damit nicht gerechnet hast, ignoriere diese Mail einfach.`,
    layout(
      `Einladung zu ${APP_NAME}`,
      `Für dich wurde ein Konto angelegt. Lege jetzt dein Passwort fest - der Link ist ${validDays} Tage gültig und nur einmal nutzbar.`,
      'Passwort festlegen',
      link,
      'Falls du damit nicht gerechnet hast, ignoriere diese Mail einfach.'
    )
  )
}

/** Passwort-Reset auf Wunsch des Kontoinhabers. */
export async function sendPasswordResetEmail(toEmail: string, link: string): Promise<boolean> {
  return send(
    toEmail,
    `Passwort zurücksetzen - ${APP_NAME}`,
    `Hallo,

für dein Konto bei ${APP_NAME} wurde ein neues Passwort angefordert. Mit diesem Link kannst du es festlegen (1 Stunde gültig, nur einmal nutzbar):
${link}

Falls du das nicht warst, ignoriere diese Mail - dein Passwort bleibt unverändert.`,
    layout(
      'Passwort zurücksetzen',
      'Für dein Konto wurde ein neues Passwort angefordert. Der Link ist 1 Stunde gültig und nur einmal nutzbar.',
      'Neues Passwort festlegen',
      link,
      'Falls du das nicht warst, ignoriere diese Mail - dein Passwort bleibt unverändert.'
    )
  )
}
