# Seating

Sitzplatz-Tool der [App-Suite](https://github.com/druXter/suite-kit): Raumpläne, Tischreservierung für Gruppen,
Platzwahl (Kino, Ball) und Sitzordnung (Hochzeit). Wie alle Tools der Suite **eigenständig zuerst** – eigene Datenbank,
eigene Konten, eigenes Deployment. Die Anbindung an rsvp-app und die Konto-Föderation über `suite-kit` sind optionale
Zusätze.

Fachliche Grundlage und Fahrplan: [docs/KONZEPT.md](docs/KONZEPT.md).

## Stand

| Phase | Inhalt | Stand |
| --- | --- | --- |
| 0 | Gerüst, Admin-Login, Kontoverwaltung, Sicherheits-Header, Docker, Tests | ✅ umgesetzt |
| 1 | Raumplan-Editor, Vorlagen, Import/Export | offen |
| 2 | Events mit Plan-Snapshot, öffentliche Planansicht | offen |
| 3 | Tischbuchung mit Verifizierung, `.ics`, Verwaltungslink | offen |
| 4–8 | Buchungsverwaltung, Modi `SEAT`/`ASSIGNED`, rsvp-app, Föderation | offen |

Bisher gibt es also nur die Konten der Veranstalter\*innen – Buchen ist noch nicht möglich.

## Konten

Konten gibt es nur für Veranstalter\*innen. Buchende brauchen nie ein Konto.

### Rollen

Gleiche Rollen wie im Abstimmungstool und in rsvp-app, aber eigenständig vergeben:

| Rolle | Darf |
| --- | --- |
| **ADMIN** | alles: alle Events und Raumpläne, Konten anlegen/löschen, Rollen vergeben |
| **CREATOR** | eigene Events und Raumpläne anlegen und verwalten, mit anderen teilen, Moderator\*innen einladen |
| **MODERATOR** | legt nichts selbst an, bearbeitet nur freigegebene Events (z. B. das Brautpaar die eigene Hochzeit) |

Die Freigabe einzelner Events an Konten (analog zum Teilen von Abstimmungen) kommt mit Phase 2.

### Erstes Konto und weitere Konten

Es gibt keine öffentliche Registrierung. Das allererste Konto entsteht auf dem Server:

```bash
node create-user.js deine-email@domain.de ADMIN                              # lokal, Passwort wird verdeckt abgefragt
node create-user.js deine-email@domain.de ADMIN --invite                     # stattdessen Einmal-Link (7 Tage)
docker compose run --rm seating node create-user.js deine-email@domain.de ADMIN --invite
```

Weitere Konten lädt man unter `/admin/users` ein: Die Person bekommt einen Einmal-Link (7 Tage gültig) und legt ihr
Passwort **selbst** fest. Ohne `SMTP_HOST` zeigt die Seite den Link dem einladenden Konto einmalig zum Weitergeben an. Nur
Admins vergeben die Rollen CREATOR/ADMIN; Creator laden ausschließlich Moderator\*innen ein. Admin-Konten lassen sich in
der Oberfläche bewusst weder ändern noch löschen (Schutz vor Aussperren) und haben keinen Passwort-Reset per Mail – das
geht nur per `create-user.js`.

## Sicherheit

Übernommen aus dem Abstimmungstool (Referenzimplementierung der Suite, siehe README von `suite-kit`):

* **Passwörter:** scrypt (`node:crypto`, N=2^15, r=8, p=3) mit eingebetteten Parametern; alte Hashes werden beim
  nächsten Login automatisch erneuert. Mindestens 10 Zeichen, keine Zeichenklassen-Regeln, Abgleich gegen naheliegende
  Fälle – serverseitig geprüft, nicht nur per `minLength` im Browser.
* **Passwort-Raten:** Drosselung pro IP (20 Versuche) **und** pro Ziel-E-Mail (10 Versuche) in 15 Minuten
  (`app/lib/throttle.ts`). Der Versuch wird **vor** der Prüfung atomar reserviert, sodass auch viele gleichzeitige
  Anfragen das Limit nicht umgehen. Keine dauerhafte Kontosperre. Gleiche Meldung und gleiche Rechenzeit für bekannte
  und unbekannte Adressen. „Passwort vergessen“ antwortet immer neutral und schickt höchstens 3 Mails pro Adresse und
  Stunde. Gespeichert werden nur SHA-256-Hashes von IP und E-Mail.
* **`TRUST_PROXY_HOPS`** muss zur Proxy-Kette passen – messen, nicht raten (Anleitung in `.env.example`).
* **Sitzungen:** zufälliger Token im Cookie `__Host-session` (HttpOnly, Secure, SameSite=Lax, ohne Domain-Attribut),
  in der Datenbank nur als SHA-256-Hash. Neue Sitzung bei jedem Login, ein Passwortwechsel beendet alle anderen
  Sitzungen. Einladungs-/Reset-Links: einmalig, befristet, nur als Hash; das bloße Öffnen (GET) verbraucht sie nicht.
* **Berechtigungen** prüft jede Server Action selbst, nie nur die Oberfläche. Server Actions prüfen zusätzlich den
  Origin (CSRF, Next.js-Standard).
* **Header** (`next.config.ts`): `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS für alle Seiten.
  Login, Konto, Verwaltung, Reset- und Verwaltungslinks zusätzlich `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `X-Robots-Tag: noindex` und `Cache-Control: no-store`; Seiten mit Einmal-Werten in der URL `Referrer-Policy:
  no-referrer`. Die Reihenfolge der Regeln ist wichtig (die spätere gewinnt) und in der Datei kommentiert – ab Phase 2
  werden öffentliche Eventseiten gezielt einbettbar.
* **Reservierte Adressen:** Events liegen später unter `/<slug>`. Alle Pfade des Tools stehen in `app/lib/slugs.ts`;
  ein Test schlägt fehl, sobald eine neue Route dort fehlt.

## Automatische Löschung

Ein externer Scheduler (z. B. Uptime Kuma) ruft **einmal täglich** auf:

`GET https://plaetze.deine-domain.de/api/cron/cleanup?secret=<CRON_SECRET>`

Ein leeres oder fehlendes `CRON_SECRET` lässt niemanden durch. Stand Phase 0 gelöscht werden: Konten nach 2 Jahren ohne
Anmeldung (Admin-Konten ausgenommen), abgelaufene Sitzungen, Einladungs-/Reset-Links und Drossel-Zähler. Mit den
Buchungen kommen die Fristen aus dem Konzept dazu (Events 18 Monate nach Ende, abgelaufene/stornierte Buchungen nach
30 Tagen).

## Setup

```bash
npm install
cp .env.example .env    # Werte eintragen, siehe Kommentare in der Datei
npx prisma db push      # legt prisma/dev.db an, erzeugt den Prisma-Client
node create-user.js deine-email@domain.de ADMIN
npm run dev             # http://localhost:3700
```

Es gibt keinen `migrations`-Ordner – wie in den anderen Tools der Suite ausschließlich per `npx prisma db push`.

## Tests

```bash
npm test            # Unit-Tests (vitest): Passwort, Drossel-IP, Formular-Helfer, Slugs, Cron-Secret
npm run test:e2e    # Playwright gegen eine frisch gebaute Instanz auf http://127.0.0.1:3701
```

Die E2E-Tests löschen und erzeugen bei jedem Lauf ihre eigene Datenbank `prisma/test.db` (nie die Entwicklungs-
oder Produktivdatenbank), bauen mit `next build` und starten `next start` – sie prüfen also das, was auch in Produktion
läuft. Geprüft werden u. a.: Sicherheits-Header je Pfadgruppe, Session-Cookie und Hash in der Datenbank,
Session-Fixation, Open Redirect, gleiche Meldung und Antwortzeit bei unbekannten Adressen, Sperre beim 11. Versuch pro
E-Mail und 21. pro IP, erfundene `X-Forwarded-For`-Einträge, 30 gleichzeitige Versuche, Einladungs-/Reset-Link
(einmalig, GET verbraucht nichts), gefälschte Formular-POSTs ohne Berechtigung und mit fremdem Origin – jeweils **mit
Positivkontrolle**, dass derselbe POST als berechtigtes Konto wirkt.

Voraussetzung: Chromium für Playwright (`npx playwright install chromium`, einmalig).

## Deployment

Docker Compose, gleiches Prinzip wie bei den anderen Tools:

```bash
mkdir -p data && sudo chown 1000:1000 data   # einmalig, siehe unten
docker compose up -d --build
docker compose run --rm seating node create-user.js deine-email@domain.de ADMIN --invite
```

* Der Container läuft **nicht als root**, sondern als Nutzer `node` (UID 1000). Das gemountete Verzeichnis `./data`
  (SQLite-Datenbank) muss ihm gehören – legt Docker es selbst an, gehört es root und der Start scheitert.
* Installiert wird mit `npm ci` exakt nach `package-lock.json`. Das gemeinsame Paket `suite-kit` kommt direkt von
  GitHub, das Dockerfile installiert dafür `git`.
* Beim Start synchronisiert `prisma db push` das Schema, dann startet `next start` auf Port 3000 im Container.
  Voreingestellt ist Host-Port 3007 (3005/3006 sind von rsvp-app und Abstimmungstool belegt).
* **Vor jedem Update die Datenbank sichern** (`data/prod.db` kopieren).

## Umgebungsvariablen

Siehe `.env.example` (mit Erklärungen). Kurzüberblick:

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | SQLite-Datei (in Docker per Compose gesetzt) |
| `BASE_URL` | öffentliche Adresse ohne Slash – für Links in Mails, später auch Kennung in der Suite |
| `TRUST_PROXY_HOPS` | Anzahl eigener Reverse Proxys (für die IP der Drosselung) |
| `CRON_SECRET` | Schutz des Aufräum-Endpunkts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailversand (Phase 0 optional, ab Phase 3 nötig) |
| `IMPRESSUM_*` | Angaben für Impressum und Datenschutzerklärung |

Später kommen dazu: `MANAGE_LINK_SECRET(_PREVIOUS)` (Phase 3), `RSVP_*` (Phase 7), `SUITE_*` (Phase 8), optional
`TURNSTILE_*`.
