import { defineConfig, devices } from '@playwright/test'
import { SMTP_PORT } from './tests/e2e/mail-server'
import { RSVP_ORIGIN, TEST_RSVP_SECRET } from './tests/e2e/rsvp-server'
import { SUITE_TOOLS, TEST_SEATING_SIGNING_KEY, TEST_SUITE_IDPS, TEST_SUITE_TRUSTED_APPS } from './tests/e2e/suite-server'

// E2E-Tests gegen eine echte, frisch gebaute Instanz (next build + next start) mit eigener
// Datenbank (prisma/test.db) - nie gegen die Entwicklungs- oder Produktivdatenbank.
//
// 127.0.0.1 statt localhost: Cookies sind nicht an Ports gebunden, eine parallel laufende
// Entwicklungsinstanz (localhost:3700) oder ein anderes Tool der Suite auf localhost würde
// sonst dieselben Cookies sehen (siehe CLAUDE.md, Stolpersteine).
const PORT = 3701
export const BASE_URL = `http://127.0.0.1:${PORT}`
// Zweite Instanz mit demselben Build, derselben Datenbank und derselben BASE_URL, aber mit
// SUITE_LOGIN_REDIRECT (bevorzugter Anbieter Tool A): Ihre Login-Seite leitet direkt weiter, der
// Rücksprung landet über BASE_URL bei der ersten Instanz (tests/e2e/login-redirect.spec.ts).
export const REDIRECT_PORT = 3702
export const TEST_CRON_SECRET = 'e2e-cron-secret'
export const TEST_UPLOAD_DIR = 'data/test-uploads'

// Gilt für den Server UND für die Testprozesse (tests/e2e/helpers.ts greift direkt auf die
// Datenbank zu). Relative SQLite-Pfade löst Prisma relativ zu prisma/schema.prisma auf.
process.env.DATABASE_URL = 'file:./test.db'
// Buchungs-Secrets nur für die Tests - auch im Testprozess gesetzt, damit er Verwaltungslinks und
// Codes selbst berechnen kann (app/lib/booking-tokens.ts).
process.env.VERIFY_CODE_SECRET = 'e2e-verify-code-secret-0123456789abcdef'
process.env.MANAGE_LINK_SECRET = 'e2e-manage-link-secret-0123456789abcdef'
process.env.MANAGE_LINK_SECRET_PREVIOUS = 'e2e-previous-manage-secret-0123456789ab'
process.env.BASE_URL = BASE_URL
// Anbindung an rsvp-app (Phase 7): Test-Doppel tests/e2e/rsvp-server.ts, gleiches Secret im Testprozess.
process.env.RSVP_SEATING_SECRET = TEST_RSVP_SECRET
process.env.RSVP_APP_BASE_URL = RSVP_ORIGIN

const SERVER_ENV: Record<string, string> = {
  DATABASE_URL: 'file:./test.db',
  BASE_URL,
  // Ein Proxy: Die Tests spielen ihn selbst und setzen X-Forwarded-For, um verschiedene
  // Besucher-IPs zu simulieren.
  TRUST_PROXY_HOPS: '1',
  CRON_SECRET: TEST_CRON_SECRET,
  // Eigenes Upload-Verzeichnis, wird wie die Test-Datenbank bei jedem Lauf geleert.
  UPLOAD_DIR: TEST_UPLOAD_DIR,
  // Test-SMTP aus tests/e2e/mail-server.ts (in global-setup gestartet). Empfänger @nomail.test
  // lehnt er ab - dann greift z.B. der angezeigte Einladungslink.
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(SMTP_PORT),
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: 'Seating Test <seating@example.test>',
  VERIFY_CODE_SECRET: process.env.VERIFY_CODE_SECRET!,
  MANAGE_LINK_SECRET: process.env.MANAGE_LINK_SECRET!,
  MANAGE_LINK_SECRET_PREVIOUS: process.env.MANAGE_LINK_SECRET_PREVIOUS!,
  RSVP_SEATING_SECRET: TEST_RSVP_SECRET,
  RSVP_APP_BASE_URL: RSVP_ORIGIN,
  // Konto-Föderation (Phase 8): zwei andere Tools aus tests/e2e/suite-server.ts - Seating nimmt
  // Anmeldungen von beiden an und stellt selbst welche für Tool A aus.
  SUITE_IDPS: TEST_SUITE_IDPS,
  SUITE_TRUSTED_APPS: TEST_SUITE_TRUSTED_APPS,
  SUITE_SIGNING_KEY: TEST_SEATING_SIGNING_KEY,
  SUITE_APP_NAME: 'Seating Test',
  // Rundmail-Warteschlange zügig abarbeiten (100 ms Pause statt 2 s).
  BROADCAST_MAILS_PER_MINUTE: '600',
  // Kein Hintergrund-Durchlauf: Die Tests lösen ihn gezielt über den Cron aus (sonst hinge ihr
  // Ergebnis davon ab, wann die Minute umspringt).
  SWEEP_INTERVAL_SECONDS: '0',
  TZ: 'Europe/Berlin'
}

export default defineConfig({
  testDir: './tests/e2e',
  // Alle Tests teilen sich eine Datenbank und die Drossel-Zähler - nacheinander ausführen.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    ...devices['Desktop Chrome'],
    locale: 'de-DE'
  },
  webServer: [{
    // Datenbank bei jedem Lauf frisch anlegen (nur die eigene Testdatei löschen - bewusst kein
    // `prisma db push --force-reset`, das bei falsch gesetzter DATABASE_URL eine fremde
    // Datenbank leeren würde), dann wie in Produktion bauen und starten.
    command: `rm -rf prisma/test.db prisma/test.db-journal data/test-uploads && npx prisma db push --skip-generate && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/impressum`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: SERVER_ENV
  }, {
    // Startet nach der ersten Instanz (Playwright richtet die Server nacheinander ein) und nutzt deren Build.
    command: `npx next start -H 127.0.0.1 -p ${REDIRECT_PORT}`,
    url: `http://127.0.0.1:${REDIRECT_PORT}/impressum`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...SERVER_ENV, SUITE_LOGIN_REDIRECT: SUITE_TOOLS.a.origin }
  }]
})
