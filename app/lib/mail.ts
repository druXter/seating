// app/lib/mail.ts
import nodemailer from 'nodemailer'
import { APP_NAME } from './app'
import { renderMail } from 'suite-kit/web'
import { MAIL_BRAND } from './mail-blocks'

type RenderedMail = ReturnType<typeof renderMail>

// Gleicher Transporter-Aufbau wie in rsvp-app und im Abstimmungstool - laufen die Tools
// über dasselbe Postfach, deckt der dort abgeschlossene AVV auch diesen Versand ab.
// SMTP_HOST bewusst nicht vorausgesetzt: bleibt es leer, bricht der Versand unten früh ab
// statt einen kaputten Transporter zu nutzen. Die Konto-Funktionen funktionieren dann
// trotzdem - Einladungslinks werden dem einladenden Konto direkt auf dem Bildschirm
// angezeigt (siehe app/admin/users/page.tsx). Buchungsmails brauchen SMTP - ohne ist das
// Buchen abgeschaltet (app/lib/booking-mail.ts).
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


/**
 * Mail mit Anrede, Text, einem Knopf und Kleingedrucktem - aus den Bausteinen der Suite (renderMail aus suite-kit,
 * dieselbe Vorlage in allen Tools). HTML und Klartext aus demselben Inhalt, alles escapet.
 */
function layout(heading: string, body: string, buttonLabel: string, link: string, footer: string): RenderedMail {
  return renderMail({
    brand: MAIL_BRAND,
    heading,
    blocks: [{ kind: 'p', text: 'Hallo,' }, { kind: 'p', text: body }, { kind: 'button', label: buttonLabel, href: link }],
    footer
  })
}

export type MailAttachment = { filename: string; content: string; contentType: string }

export type SendResult = { ok: true } | { ok: false; error: string }

/**
 * Verschickt eine Mail. Der Absender ist immer SMTP_FROM (ein pro Event frei wählbarer Absender
 * würde SPF/DMARC verletzen und im Spam landen) - pro Event gibt es nur ein Reply-To.
 */
export async function sendMail(
  toEmail: string, subject: string, text: string, html: string,
  options: { replyTo?: string | null; attachments?: MailAttachment[] } = {}
): Promise<SendResult> {
  if (!isMailConfigured()) return { ok: false, error: 'SMTP nicht konfiguriert' }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: toEmail,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      subject,
      text,
      html,
      attachments: options.attachments,
      envelope: { from: process.env.SMTP_USER || undefined, to: toEmail }
    })
    return { ok: true }
  } catch (error) {
    console.error(`Fehler beim Senden einer Mail an ${toEmail}:`, error)
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Unbekannter Fehler' }
  }
}

async function send(toEmail: string, subject: string, { html, text }: RenderedMail): Promise<boolean> {
  return (await sendMail(toEmail, subject, text, html)).ok
}

/** Einladung zu einem neu angelegten Konto - der Link legt das erste Passwort fest. */
export async function sendInviteEmail(toEmail: string, link: string, validDays: number): Promise<boolean> {
  return send(
    toEmail,
    `Einladung zu ${APP_NAME}`,
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
    layout(
      'Passwort zurücksetzen',
      'Für dein Konto wurde ein neues Passwort angefordert. Der Link ist 1 Stunde gültig und nur einmal nutzbar.',
      'Neues Passwort festlegen',
      link,
      'Falls du das nicht warst, ignoriere diese Mail - dein Passwort bleibt unverändert.'
    )
  )
}
