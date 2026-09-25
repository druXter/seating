import { defineConfig, devices } from '@playwright/test'

// E2E-Tests gegen eine echte, frisch gebaute Instanz (next build + next start) mit eigener
// Datenbank (prisma/test.db) - nie gegen die Entwicklungs- oder Produktivdatenbank.
//
// 127.0.0.1 statt localhost: Cookies sind nicht an Ports gebunden, eine parallel laufende
// Entwicklungsinstanz (localhost:3700) oder ein anderes Tool der Suite auf localhost würde
// sonst dieselben Cookies sehen (siehe CLAUDE.md, Stolpersteine).
const PORT = 3701
export const BASE_URL = `http://127.0.0.1:${PORT}`
export const TEST_CRON_SECRET = 'e2e-cron-secret'

// Gilt für den Server UND für die Testprozesse (tests/e2e/helpers.ts greift direkt auf die
// Datenbank zu). Relative SQLite-Pfade löst Prisma relativ zu prisma/schema.prisma auf.
process.env.DATABASE_URL = 'file:./test.db'

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
  webServer: {
    // Datenbank bei jedem Lauf frisch anlegen (nur die eigene Testdatei löschen - bewusst kein
    // `prisma db push --force-reset`, das bei falsch gesetzter DATABASE_URL eine fremde
    // Datenbank leeren würde), dann wie in Produktion bauen und starten.
    command: `rm -f prisma/test.db prisma/test.db-journal && npx prisma db push --skip-generate && npx next build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/impressum`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL: 'file:./test.db',
      BASE_URL,
      // Ein Proxy: Die Tests spielen ihn selbst und setzen X-Forwarded-For, um verschiedene
      // Besucher-IPs zu simulieren.
      TRUST_PROXY_HOPS: '1',
      CRON_SECRET: TEST_CRON_SECRET,
      // Kein Mailversand: Einladungslinks werden angezeigt, Reset-Mails gehen nirgendwohin.
      SMTP_HOST: '',
      TZ: 'Europe/Berlin'
    }
  }
})
