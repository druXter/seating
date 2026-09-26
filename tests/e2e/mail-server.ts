import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SMTPServer } from 'smtp-server'
import { simpleParser, type ParsedMail } from 'mailparser'

// Test-SMTP für die E2E-Tests (statt Mailpit, damit die Tests ohne Docker laufen): nimmt jede Mail an
// und legt sie als .eml in MAIL_DIR ab. Empfänger unter @nomail.test werden abgelehnt - so lässt sich
// ein gescheiterter Versand testen (Einladungslink auf dem Bildschirm, Buchung ohne Mail).

export const SMTP_PORT = 2526
export const MAIL_DIR = 'data/test-mails'
export const REJECTED_DOMAIN = 'nomail.test'

export function startMailServer(): Promise<SMTPServer> {
  rmSync(MAIL_DIR, { recursive: true, force: true })
  mkdirSync(MAIL_DIR, { recursive: true })
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    logger: false,
    onRcptTo(address, _session, callback) {
      if (address.address.toLowerCase().endsWith(`@${REJECTED_DOMAIN}`)) return callback(new Error('Empfänger abgelehnt (Test)'))
      callback()
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        writeFileSync(join(MAIL_DIR, `${Date.now()}-${randomBytes(4).toString('hex')}.eml`), Buffer.concat(chunks))
        callback()
      })
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(SMTP_PORT, '127.0.0.1', () => resolve(server))
  })
}

export type CapturedMail = ParsedMail & { file: string }

async function allMails(): Promise<CapturedMail[]> {
  const files = readdirSync(MAIL_DIR).filter(f => f.endsWith('.eml')).sort()
  return Promise.all(files.map(async file => ({ ...(await simpleParser(readFileSync(join(MAIL_DIR, file)))), file })))
}

function recipients(mail: ParsedMail): string[] {
  const to = Array.isArray(mail.to) ? mail.to : mail.to ? [mail.to] : []
  return to.flatMap(address => address.value.map(v => (v.address ?? '').toLowerCase()))
}

/** Alle Mails an eine Adresse (älteste zuerst). */
export async function mailsTo(email: string): Promise<CapturedMail[]> {
  return (await allMails()).filter(mail => recipients(mail).includes(email.toLowerCase()))
}

/** Wartet, bis mindestens `count` Mails an die Adresse da sind, und gibt die neueste zurück. */
export async function waitForMail(email: string, count = 1, timeoutMs = 10_000): Promise<CapturedMail> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const mails = await mailsTo(email)
    if (mails.length >= count) return mails[mails.length - 1]
    if (Date.now() > deadline) throw new Error(`Keine ${count}. Mail an ${email} angekommen (bisher ${mails.length})`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
