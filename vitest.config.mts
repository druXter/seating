import { defineConfig } from 'vitest/config'

// Unit-Tests für die Bibliotheksfunktionen in app/lib (reine Logik, Node-Umgebung).
// Abläufe im Browser und Sicherheitsfälle prüft Playwright gegen eine laufende Instanz (tests/e2e).
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
})
