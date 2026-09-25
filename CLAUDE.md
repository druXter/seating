# Seating – Hinweise für Claude Code

@AGENTS.md

Sitzplatz-Tool der App-Suite (Raumpläne, Tischbuchung, Platzwahl, Sitzordnung). Eigenständig lauffähig, optional an
rsvp-app und die Konto-Föderation von `suite-kit` anbindbar.

**Fachliche Grundlage: [docs/KONZEPT.md](docs/KONZEPT.md).** Vor jeder Phase den passenden Abschnitt lesen. Abweichungen
vom Konzept nicht still umsetzen, sondern vorschlagen und das Konzept mit aktualisieren.

## Referenz: Abstimmungstool und suite-kit

Seating folgt den Mustern der bestehenden Tools. **Bevor neuer Code entsteht**, im Abstimmungstool nachsehen und
übernehmen statt neu erfinden:

* `package.json`, Next.js-Version, DB/ORM, Test-Setup, `Dockerfile`, `next.config.ts` (Header-Regeln)
* `app/lib/{suite,suite-flow,auth,throttle,password}.ts`, `app/api/suite/*`
* den RSVP-Vertrag (`RSVP_VERIFICATION_SECRET`) – Vorbild für die rsvp-app-Anbindung
* das README von `suite-kit` (Leitprinzipien, Sicherheitsregeln, Stolpersteine)

Ort der Repos: lokal neben diesem Repo (`../abstimmungstool`, `../suite-kit`, `../rsvp-app`), sonst
`github.com/druXter/<repo>`. Wenn nicht auffindbar: nachfragen, nicht raten.

**Andere Repos nur lesen.** Nötige Änderungen an rsvp-app oder suite-kit als Liste vorschlagen.

## Befehle

```bash
npm run dev                  # Port 3700 (Abstimmungstool: 3600)
npm test                     # Unit-Tests (vitest, tests/unit)
npm run test:e2e             # Playwright gegen eigene Instanz auf 127.0.0.1:3701 (baut vorher, test.db)
npm run build
npm run lint
npx prisma db push           # Schema synchronisieren, keine Migrationen (wie in der Suite)
node create-user.js <email> ADMIN [--invite]
```

AGENTS.md wird von `next dev` gepflegt (Hinweise zur Next.js-Version) und oben per `@AGENTS.md` eingebunden – nicht
löschen, sonst schreibt `next dev` seinen Block direkt in diese Datei.

## Konventionen

* TypeScript strict. Bezeichner, Dateinamen, DB-Felder englisch; **UI-Texte und Mails deutsch**, gendergerecht mit
  Sternchen (Teilnehmer*innen), Anrede "du".
* Eingaben serverseitig validieren – mit den Helfern aus `app/lib/form.ts` (`formString`, `formPassword`,
  `normalizeEmail`, wie im Abstimmungstool; dort gibt es keine Validierungs-Bibliothek). Vor Phase 1 (Import von
  Raumplänen als JSON) neu entscheiden, ob eine Schema-Bibliothek sich lohnt.
* `'use server'`-Dateien exportieren nur async-Funktionen.
* Kleine, nachvollziehbare Commits. Keine neuen Abhängigkeiten ohne kurze Begründung.

## Sicherheitsregeln (nicht verhandelbar)

Alle Regeln aus dem suite-kit-README gelten. Zusätzlich für Seating:

* **Doppelbuchung verhindert der Unique-Index `Allocation(eventId, unitId)`**, nicht eine vorherige Abfrage. Buchen in
  einer Transaktion: abgelaufene Holds freigeben → einfügen → Konflikt sauber abfangen.
* **GET verändert nie Daten.** Verifizierungslinks öffnen eine Seite mit Button (POST) – Mail-Scanner rufen Links vorab auf.
* Verifizierungstoken/-codes nur als Hash, Codes mit Versuchslimit. Verwaltungslinks per HMAC abgeleitet (siehe Konzept
  Abschnitt 6), Vergleich mit konstanter Laufzeit.
* Berechtigung in **jeder** Server Action und jedem Route Handler prüfen: Admin-Session bzw. gültiger Verwaltungslink
  *für genau diese Buchung*.
* Öffentliche Ansichten zeigen keine Namen oder Kontaktdaten anderer Buchender.
* Buchungsformulare und Mail auslösende Aktionen drosseln (IP und E-Mail), Versuch vor der Prüfung atomar reservieren.
* Reservierte Slugs ablehnen; Header-Regeln so ordnen, dass Ausnahmen hinter den allgemeinen Regeln stehen.

## Arbeitsweise

* **Eine Phase pro Sitzung** (Phasen: Konzept Abschnitt 12). Erst Plan vorlegen, nach Freigabe umsetzen.
* Jede Phase endet mit: Tests (Unit mit vitest in `tests/unit`, Playwright in `tests/e2e` gegen laufende Instanz für
  Abläufe und Sicherheitsfälle, inkl. Positivkontrolle), README aktualisiert, Konzept bei Abweichungen angepasst, **Hinweis an mich, zu committen und zu pushen**.
* Mails lokal gegen einen Test-SMTP (z. B. Mailpit) prüfen, `.ics` mit einem Validator und mindestens einem echten Client.
* Lokal zwei Tools gleichzeitig testen: unterschiedliche Hostnamen (`localhost` / `127.0.0.1`), nicht nur Ports.

## Stolpersteine (bekannt)

* Server Action → Redirect auf Route Handler → Redirect auf fremde Domain hängt im Client-Router: Zwischenseite mit
  `window.location.replace`.
* Bei mehreren passenden `headers()`-Regeln gewinnt die spätere. `/admin` passt auch auf `/:slug`.
* Öffentliche Eventseiten evtl. einbettbar halten (wie rsvp-app); `frame-ancestors 'none'` nur für Admin, Login,
  Verwaltungslink-Seiten.
* Playwright: gefälschte POSTs erst nach frischem Seitenaufruf bauen (sonst fehlt `$ACTION_ID`).
* `TRUST_PROXY_HOPS` messen, nicht raten.
