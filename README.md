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
| 1 | Raumplan-Editor, Vorlagen, Import/Export, Hintergrundbild | ✅ umgesetzt |
| 2 | Events mit Plan-Snapshot, Freigaben, öffentliche Planansicht mit Belegung | ✅ umgesetzt |
| 3 | Tischbuchung mit Verifizierung, Verfall, `.ics`, Verwaltungslink | ✅ umgesetzt |
| 4 | Buchungsverwaltung: ändern, verschieben, stornieren, löschen, anlegen, Rundmail, Audit, Export, Druckansicht | ✅ umgesetzt |
| 4b–8 | Warteliste, Modi `SEAT`/`ASSIGNED`, rsvp-app, Föderation | offen |

Tische lassen sich online buchen (Modus `TABLE`, Zugang `OPEN`), Veranstalter\*innen verwalten die Buchungen im
Admin-Bereich.

## Konten

Konten gibt es nur für Veranstalter\*innen. Buchende brauchen nie ein Konto.

### Rollen

Gleiche Rollen wie im Abstimmungstool und in rsvp-app, aber eigenständig vergeben:

| Rolle | Darf |
| --- | --- |
| **ADMIN** | alles: alle Events und Raumpläne, Konten anlegen/löschen, Rollen vergeben |
| **CREATOR** | eigene Events und Raumpläne anlegen und verwalten, mit anderen teilen, Moderator\*innen einladen |
| **MODERATOR** | legt nichts selbst an, bearbeitet nur freigegebene Events (z. B. das Brautpaar die eigene Hochzeit) |

Einzelne Events lassen sich weiteren Konten freigeben (analog zum Teilen von Abstimmungen), siehe [Events](#events).

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

## Raumpläne

Unter `/admin/plans` legen Creator und Admins wiederverwendbare Raumpläne an (Moderator\*innen nicht). Ein Plan ist eine
**Vorlage**: Beim Anlegen eines Events wird er kopiert, spätere Änderungen verändern keine laufenden Events.

* **Elemente:** Tische (rund, rechteckig, oval; Plätze werden automatisch rundherum verteilt, einzelne Seiten
  abschaltbar), einzelne Stühle, Reihenblöcke (Reihen × Plätze, Gänge, weggelassene Plätze, Krümmung, Beschriftung A/B/…
  oder 1/2/…, Zählrichtung) und nicht buchbare Objekte (Bühne, Tanzfläche, Bar, Buffet, Tür, Säule, Wand, Text).
* **Editor:** SVG mit Ziehen (Einrasten am Raster), Drehgriff (15°-Schritte, mit Umschalt frei), Mehrfachauswahl
  (Umschalt+Klick), Duplizieren (Strg+D), Löschen (Entf), Pfeiltasten (ein Rasterfeld, mit Alt 1 cm),
  Rückgängig/Wiederholen, Zoom (Mausrad) und Verschieben der Ansicht. Alle Werte lassen sich auch im
  Eigenschaften-Panel eintippen; die Elementliste erlaubt die Auswahl per Tastatur.
* **Speichern** ausdrücklich (Button oder Strg+S). Hat inzwischen jemand anderes gespeichert (zweiter Tab, anderes Konto),
  wird nichts überschrieben – der Editor meldet den Konflikt und bietet an, den eigenen Stand herunterzuladen.
* **Stabile Schlüssel:** Jede buchbare Einheit hat einen unveränderlichen Schlüssel (`t12`, `t12-s3`, `s5`,
  `blk1-r2-s12` = Block 1, Reihe 2 von vorne, Position 12 von links). Umbenennen, Verschieben, Drehen oder eine andere
  Reihen-/Platzzählung ändern ihn nicht; gelöschte Nummern werden nie neu vergeben.
* **Import/Export** als JSON (`format: "seating-floorplan"`, `schemaVersion`). Ein Import legt immer einen neuen Plan an
  und durchläuft dieselbe Prüfung wie jedes Speichern (zod, `app/lib/floorplan/schema.ts`: Aufbau, eindeutige
  Schlüssel, Wertebereiche, höchstens 500 Elemente und 3000 Plätze).
* **Gemeinsame Vorlage:** Ein Plan ist privat (besitzendes Konto und Admins). Mit „Als gemeinsame Vorlage anbieten“
  können andere Creator ihn ansehen, exportieren und duplizieren, aber nicht ändern.
* **Hintergrundbild:** PNG, JPEG oder WebP bis 5 MB als Unterlage, Lage/Breite/Deckkraft im Editor. Die Dateiart wird am
  Inhalt erkannt (kein SVG). Gespeichert in `UPLOAD_DIR` (Standard `data/uploads`), ausgeliefert nur an Konten mit
  Zugriff auf den Plan, mit `nosniff` und `Content-Security-Policy: sandbox`. Nicht Teil des Exports.

## Events

Unter `/admin/events` legen Creator und Admins Events an, Moderator\*innen sehen dort die ihnen freigegebenen.

* **Anlegen** aus einem Raumplan (eigene oder gemeinsame Vorlage): Titel, Adresse (Vorschlag aus dem Titel), Beginn,
  Ende, Ort, Beschreibung. Plan **und** Hintergrundbild werden kopiert. Neue Events sind ein Entwurf.
* **Modus:** vorerst nur „Tischbuchung für Gruppen“ (`TABLE`, Zugang `OPEN`). Einzelplätze und Sitzordnung
  erscheinen im Formular als „folgt“, der Server lehnt sie ab.
* **Status:** Entwurf und Archiviert sind öffentlich nicht sichtbar (404), Konten mit Zugriff sehen eine Vorschau.
  Veröffentlicht und Geschlossen sind sichtbar, Geschlossen ohne Buchungsmöglichkeit.
* **Einstellungen:** Adresse (Slug; reservierte Namen und vergebene Adressen werden abgelehnt), Zeiten in der Zeitzone
  des Events (vorerst immer Europe/Berlin, gespeichert in UTC), Buchungszeitraum, **Mindestbelegung** eines Tisches
  in % (50 = ein 8er-Tisch ab 4 Personen).
* **Plan des Events** ist eine eigene Kopie und im selben Editor bearbeitbar. Sobald Tische belegt sind, lehnt der
  Server ab, sie zu löschen, unter die belegte Personenzahl zu verkleinern oder auf „nicht buchbar“ zu setzen;
  Umbenennen und Verschieben geht immer. Zusätzlich verhindert die Datenbank das Löschen belegter Einheiten.
  „Plan aus Vorlage neu übernehmen“ holt den aktuellen Stand der Vorlage mit denselben Prüfungen.
* **Einheiten:** Jeder Tisch und Platz steht mit seinem stabilen Schlüssel in der Tabelle `Unit` und wird bei jedem
  Speichern abgeglichen. Belegt ist eine Einheit durch eine bestätigte Buchung oder eine unbestätigte, deren Frist
  noch läuft – Abgelaufenes zählt schon beim Lesen nicht.
* **Freigaben:** Besitzer\*in oder Admin gibt das Event per E-Mail-Adresse einem bestehenden Konto frei. Freigegebene
  Konten dürfen alles außer löschen und weiter freigeben. Admins sehen alle Events.
* **Löschen:** nur Besitzer\*in oder Admin, mit Warnung bei aktiven Buchungen (die Buchenden werden nicht
  benachrichtigt – wer das will, schickt vorher eine Rundmail oder storniert einzeln mit Mail).

* **Buchungs-Einstellungen:** Reservierung ohne Bestätigung (Standard 30 Minuten, 5–1440), Selbst ändern bis
  N Stunden vor Beginn (Standard 24, 0 = bis Beginn), eine Buchung pro E-Mail-Adresse (Standard an),
  Telefon verpflichtend, Antwortadresse (Reply-To) und Hinweis für die Bestätigungsmail.

### Öffentliche Eventseite

`https://plaetze.deine-domain.de/<adresse>` zeigt Titel, Zeit, Ort, Beschreibung und den Plan mit Belegung:

* Zoom und Verschieben (Maus: ziehen, Strg + Mausrad; Handy: zwei Finger – ein Finger scrollt weiter die Seite),
  Knöpfe für +, − und „Ganzer Plan“.
* „Wie viele Personen seid ihr?“ hebt passende freie Tische hervor und blendet die anderen ab (inkl.
  Mindestbelegung); die Auswertung passiert nur im Browser.
* Zustand nie nur über Farbe: belegt ist schraffiert, dazu Text am Tisch, Legende und eine **Tischliste** als
  gleichwertige Alternative.
* Öffentlich gibt es nur „frei / belegt / nicht buchbar“ – nie Namen, Adressen oder den Unterschied zwischen
  bestätigt und unbestätigt.
* **Buchen** (wenn veröffentlicht, im Buchungszeitraum, vor Beginn, mit SMTP und Secrets): Tisch im Plan antippen oder
  in der Liste „Buchen“ wählen, Name, E-Mail, ggf. Telefon, Personenzahl (zweimal), Anmerkung, Datenschutzhinweis.
  Der Tisch ist sofort reserviert, bis die Frist abläuft; bestätigt wird per Link aus der Mail (Seite mit Button – ein
  bloßer Aufruf bestätigt nichts, weil Mail-Scanner Links vorab öffnen) oder per 6-stelligem Code auf der Seite.
  Danach kommt die Bestätigungsmail mit `.ics` und persönlichem **Verwaltungslink** (`/b/<id>/<token>`): bis zur
  Änderungsfrist Name, Telefon, Anmerkung, Personenzahl und Tisch ändern oder stornieren, jeweils mit Mail und
  aktualisierter Kalenderdatei. Die E-Mail-Adresse ist nicht änderbar.
* Die Seite ist **per iFrame einbettbar** (wie in rsvp-app, `frame-ancestors *`) und nicht indexiert (`noindex`).
  Die Header werden beim Build festgeschrieben: Wer nur bestimmte Seiten einbetten lassen will, ändert
  `EMBEDDABLE` in `next.config.ts` und baut neu.

### Buchung: Regeln und Schutz

* **Doppelbuchung** verhindert der Unique-Index `Allocation(eventId, unitId)`, nicht eine vorherige Abfrage. Buchen läuft
  in einer Transaktion (abgelaufene Reservierungen auf dem Tisch freigeben, einfügen, Konflikt abfangen: „wurde gerade
  vergeben“). Ein Test schickt 8 gleichzeitige Anfragen auf denselben Tisch – genau eine gewinnt.
* **Tokens** (`app/lib/booking-tokens.ts`): Bestätigungslink 32 Byte Zufall, gespeichert nur als SHA-256; Code
  6 Ziffern, gespeichert als HMAC mit `VERIFY_CODE_SECRET` (nie als reiner Hash), höchstens 5 Versuche (atomar gezählt);
  Verwaltungslink = HMAC mit `MANAGE_LINK_SECRET` aus Buchungs-id und Version, nicht gespeichert, bei Schlüsselwechsel
  gilt `MANAGE_LINK_SECRET_PREVIOUS` weiter. Alle Vergleiche mit konstanter Laufzeit.
* **Erneut senden** erzeugt neuen Link und Code, setzt die Versuche zurück, verlängert die Reservierung aber nicht.
* **Eine Buchung pro Adresse:** Die Seite antwortet genauso wie bei einer neuen Reservierung (sie verrät nicht, wer schon
  gebucht hat); stattdessen bekommt die Adresse einen Hinweis mit dem Link zur bestehenden Buchung.
* **Drosselung** (eigene Tabelle `BookingThrottle`): Reservieren 10 pro IP und 5 pro E-Mail je Stunde, Code-Eingabe 30
  pro IP je 15 Minuten, erneut senden 3 pro Buchung und 10 pro IP je Stunde; höchstens 3 gleichzeitig unbestätigte
  Reservierungen pro IP und Event.
* **Mailversand gescheitert:** Die Reservierung wird sofort wieder freigegeben – kein Tisch hängt an einer Mail, die nie
  ankommt. Jede Mail steht im `MailLog`, jede Änderung im `AuditLog` (angezeigt auf der Buchungsseite im Admin-Bereich).
* **Ohne SMTP oder ohne Secrets** (je mindestens 32 Zeichen) ist das Buchen abgeschaltet – kein unsicherer Rückfall.
* **Absender** ist immer `SMTP_FROM` (pro Event frei wählbare Absender würden SPF/DMARC verletzen), pro Event gibt es ein
  Reply-To.

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
  Alle Seiten außer den öffentlichen Eventseiten `frame-ancestors 'none'` und `X-Frame-Options: DENY`; Login, Konto,
  Verwaltung, Reset-, Bestätigungs- und Verwaltungslinks zusätzlich `X-Robots-Tag: noindex` und `Cache-Control: no-store`; Seiten
  mit Einmal-Werten in der URL `Referrer-Policy: no-referrer`; Hintergrundbilder `sandbox`. Die Reihenfolge der
  Regeln ist wichtig (die spätere gewinnt, ein Header lässt sich nur überschreiben, nicht entfernen) und in der Datei
  kommentiert. Neue einteilige Seiten des Tools brauchen dort einen Eintrag, sonst wären sie einbettbar.
* **Reservierte Adressen:** Events liegen unter `/<slug>`. Alle Pfade des Tools stehen in `app/lib/slugs.ts`;
  ein Test schlägt fehl, sobald eine neue Route dort fehlt.

### Buchungen verwalten (Veranstalter\*innen)

Besitzer\*in, Admins und Konten mit Freigabe (auch Moderator\*innen) verwalten die Buchungen eines Events. Jede Aktion
prüft auf dem Server Konto, Zugriff auf das Event und dass die Buchung zu genau diesem Event gehört.

* **Plan auf der Event-Seite:** Klick auf einen belegten Tisch öffnet die Buchung, auf einen freien „Buchung anlegen“
  mit vorausgewähltem Tisch.
* **Liste** (`/admin/events/<id>/bookings`): Suche (Name, E-Mail, Telefon, Tisch), Filter nach Status (aktiv,
  bestätigt, unbestätigt, storniert, verfallen, alle), Zähler; von dort CSV-Export, Druckansicht, Tischkarten, Rundmail.
* **Buchung** (`…/bookings/<buchung>`):
  * Name, Telefon, Anmerkung, Personenzahl und Tisch ändern. Zur Wahl stehen der aktuelle und alle freien Tische,
    auch nicht buchbare. Die Mindestbelegung gilt für Veranstalter\*innen nicht, die Zahl der Plätze schon (wer
    mehr braucht, vergrößert den Tisch im Plan). Mit „Kund\*in benachrichtigen“ (Standard an) geht eine Mail mit
    Gegenüberstellung alt → neu und aktualisierter `.ics` raus. Die SEQUENCE steigt nur bei Tisch oder Personenzahl.
    Hat jemand die Buchung inzwischen geändert (Kund\*in oder zweites Konto), wird nicht still überschrieben.
  * Interne Notiz: nie in Mails, auf der Verwaltungsseite oder öffentlich.
  * Unbestätigt:
    * manuell bestätigen (die Adresse gilt dann nicht als von der Person bestätigt),
    * Bestätigungsmail erneut senden (wahlweise mit neuer Frist),
    * **E-Mail-Adresse korrigieren**: nur solange unbestätigt, die alte Adresse bekommt nichts, eine Buchung pro
      Adresse wird für die neue geprüft.
  * Verwaltungslink anzeigen und neu erzeugen: Der alte wird ungültig, auch in Kalendereinträgen. Der neue geht
    wahlweise per Mail raus.
  * Stornieren (Mail mit `.ics` CANCEL wählbar) und endgültig löschen. Beim Löschen verschwinden auch Mail- und
    Änderungsprotokoll, am Event bleibt nur ein Eintrag ohne Personendaten.
  * **Verlauf** (Audit-Log: wer hat wann was geändert) und alle Mails mit Zustellstatus.
* **Buchung anlegen** (`source = ADMIN`), z. B. telefonisch:
  * Ohne E-Mail-Adresse ist sie direkt bestätigt und bekommt keine Mails.
  * Mit Adresse wahlweise direkt bestätigt (Bestätigungsmail wählbar) oder mit Bestätigung per Mail wie online.
  * Die Regel „eine Buchung pro Adresse“ gilt auch hier.
* **Rundmail** (`…/mail`):
  * Empfänger\*innen: nur bestätigte oder auch unbestätigte Buchungen, alle oder ausgewählte Tische. Die Zahl
    rechnet die Seite live mit.
  * Vorschau des Klartexts und Testversand an das eigene Konto (mit Beispieldaten).
  * Jede\*r bekommt eine eigene Mail (kein BCC) mit den Daten der eigenen Buchung und – wenn bestätigt – dem
    persönlichen Link. Die aktuelle `.ics` kann angehängt werden.
  * Versand über eine einfache Warteschlange in der Datenbank (`MailLog` mit Status „in Warteschlange“), gedrosselt
    auf `BROADCAST_MAILS_PER_MINUTE` (Standard 30).
  * Gestartet wird der Versand direkt nach dem Absenden. Nach einem Neustart setzen Serverstart und Cron ihn fort.
    Mails, die beim Neustart gerade verschickt wurden, gelten als gescheitert und gehen nicht doppelt raus. Wer
    inzwischen storniert hat, wird übersprungen.
* **CSV-Export** mit denselben Filtern wie die Liste: UTF-8 mit BOM, Semikolon, Formel-Schutz gegen CSV-Injection
  (Zellen, die mit `= + - @` beginnen, bekommen ein `'` davor).
* **Druckansicht**: Tischliste für Einlass und Deko (mit Abhakkästchen, unbestätigte markiert) und Tischkarten.

## Automatische Löschung

Ein externer Scheduler (z. B. Uptime Kuma) ruft **einmal täglich** auf:

`GET https://plaetze.deine-domain.de/api/cron/cleanup?secret=<CRON_SECRET>`

Ein leeres oder fehlendes `CRON_SECRET` lässt niemanden durch. Der Aufruf setzt abgelaufene Reservierungen auf
„verfallen“ und gibt ihre Tische frei (beim Anzeigen zählen sie ohnehin schon nicht mehr). Gelöscht werden: verfallene
und stornierte Buchungen 30 Tage nach ihrer letzten Änderung (samt Mail- und Änderungsprotokoll), Events 18 Monate nach
ihrem Ende (samt Plan, Bild, Freigaben und Buchungen), Konten nach 2 Jahren ohne Anmeldung (Admin-Konten und Konten, denen
noch Raumpläne oder Events gehören, ausgenommen), abgelaufene Sitzungen, Einladungs-/Reset-Links und Drossel-Zähler.
Außerdem setzt der Aufruf eine unterbrochene Rundmail fort (siehe oben).
Wird ein Konto von Hand gelöscht, gehen seine Raumpläne und Events an den löschenden Admin über.

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
npm test            # Unit-Tests (vitest): Passwort, Drossel-IP, Formular-Helfer, Slugs, Cron-Secret,
                    # Raumplan-Format, Geometrie, Schlüssel, Editor-Zustand, Bilderkennung, Zeitzonen,
                    # Event-Rechte, Belegung, Plan-Änderungen, Event-Formular, .ics (Faltung, Escaping),
                    # Buchungs-Tokens (HMAC, Rotation), Buchungsregeln, Admin-Regeln (Filter, Suche,
                    # Formulare, Rundmail-Empfänger), Änderungs-Diff, Audit-Texte, CSV (Formel-Schutz),
                    # Mail-Bausteine (Maskierung)
npm run test:e2e    # Playwright gegen eine frisch gebaute Instanz auf http://127.0.0.1:3701
```

Die E2E-Tests löschen und erzeugen bei jedem Lauf ihre eigene Datenbank `prisma/test.db` und ihr Upload-Verzeichnis
`data/test-uploads` (nie die Entwicklungs- oder Produktivdaten), bauen mit `next build` und starten `next start` – sie prüfen also das, was auch in Produktion
läuft. Geprüft werden u. a.: Sicherheits-Header je Pfadgruppe, Session-Cookie und Hash in der Datenbank,
Session-Fixation, Open Redirect, gleiche Meldung und Antwortzeit bei unbekannten Adressen, Sperre beim 11. Versuch pro
E-Mail und 21. pro IP, erfundene `X-Forwarded-For`-Einträge, 30 gleichzeitige Versuche, Einladungs-/Reset-Link
(einmalig, GET verbraucht nichts), gefälschte Formular-POSTs ohne Berechtigung und mit fremdem Origin – jeweils **mit
Positivkontrolle**, dass derselbe POST als berechtigtes Konto wirkt. Für Raumpläne außerdem: Anlegen, Import/Export
(auch ungültige Dateien und HTML in Beschriftungen), Editor per Werkzeugleiste, Tastatur und Maus, Versionskonflikt mit
zwei Tabs, nachgespielte Speicher-Aufrufe fremder Konten, Freigabe als Vorlage, Bild-Upload (SVG, getarnte Dateien,
Übergröße, fremde Herkunft) und die Header der Bildauslieferung. Für Events: Anlegen mit Snapshot, Adresse
(reserviert, ungültig, vergeben), Einstellungen, Schutz belegter Tische im Editor und in nachgespielten
Speicher-Aufrufen, abgelaufene Reservierungen, Übernahme aus der Vorlage, Freigaben (Moderator\*in mit und ohne
Freigabe, kein Löschen/Weiterfreigeben), fremde Konten, Löschen mit Cascade, Umhängen beim Kontolöschen, Löschfrist;
öffentlich: 404 für Entwurf/Archiv, Vorschau, **keine Namen oder Adressen im ausgelieferten HTML**,
Gruppengrößen-Filter, Bild nur bei sichtbarem Event, einbettbare Eventseite ohne `X-Frame-Options`. Für Buchungen:
kompletter Ablauf per Link und per Code, GET bestätigt nicht, 5 falsche Codes sperren, erneut senden ohne
Verlängerung, Verfall, 8 gleichzeitige Anfragen auf einen Tisch, eine Buchung pro Adresse ohne Hinweis auf der Seite,
Obergrenze und Drosselung pro IP, gescheiterter Mailversand, Regeln (Mindestbelegung, Zeitraum, erfundene Tische),
Verwaltungslink (falscher Token, Rotation, Ändern, Tischwechsel auf belegten Tisch, Frist, Storno), `.ics` in den Mails,
Löschfristen. Für die Buchungsverwaltung:
* Liste, Filter, Suche, Links im Plan, CSV (Formel-Schutz, 404 ohne Zugriff).
* Ändern mit Mail alt → neu und SEQUENCE, belegter Tisch, zu viele Personen, veralteter Stand, ohne Mail.
* Interne Notiz nicht auf der Verwaltungsseite.
* Storno mit und ohne Mail, Löschen ohne Personendaten im Verlauf.
* Unbestätigte Buchungen: erneut senden mit und ohne Frist, E-Mail korrigieren (bestätigte per nachgespieltem
  Formular abgelehnt), manuell bestätigen.
* Buchung anlegen: ohne Adresse, direkt, mit Bestätigung, eine pro Adresse.
* Verwaltungslink neu erzeugen.
* Rundmail: Test, Filter, Warteschlange, Cron setzt fort, nichts doppelt.
* Berechtigung: Moderator\*in, fremdes Konto, Buchung eines anderen Events, ohne Sitzung.
* Druckansicht.

Mails fängt ein Test-SMTP ab (`tests/e2e/mail-server.ts`, Pakete `smtp-server` und `mailparser`, nur für die Tests), der
sie als `.eml` in `data/test-mails` ablegt; Empfänger unter `@nomail.test` lehnt er ab (gescheiterter Versand). Zur
Sichtprüfung eignet sich Mailpit (`docker run --rm -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit`, dann
`SMTP_HOST=127.0.0.1 SMTP_PORT=1025`).

Voraussetzung: Chromium für Playwright (`npx playwright install chromium`, einmalig).

## Deployment

Docker Compose, gleiches Prinzip wie bei den anderen Tools:

```bash
mkdir -p data && sudo chown 1000:1000 data   # einmalig, siehe unten
docker compose up -d --build
docker compose run --rm seating node create-user.js deine-email@domain.de ADMIN --invite
```

* Der Container läuft **nicht als root**, sondern als Nutzer `node` (UID 1000). Das gemountete Verzeichnis `./data`
  (SQLite-Datenbank, hochgeladene Bilder in `data/uploads`) muss ihm gehören – legt Docker es selbst an, gehört es
  root und der Start scheitert.
* Installiert wird mit `npm ci` exakt nach `package-lock.json`. Das gemeinsame Paket `suite-kit` kommt direkt von
  GitHub, das Dockerfile installiert dafür `git`.
* Beim Start synchronisiert `prisma db push` das Schema, dann startet `next start` auf Port 3000 im Container.
  Voreingestellt ist Host-Port 3007 (3005/3006 sind von rsvp-app und Abstimmungstool belegt).
* **Vor jedem Update die Daten sichern** (`data/prod.db` und `data/uploads/` kopieren).

## Umgebungsvariablen

Siehe `.env.example` (mit Erklärungen). Kurzüberblick:

| Variable | Zweck |
| --- | --- |
| `DATABASE_URL` | SQLite-Datei (in Docker per Compose gesetzt) |
| `BASE_URL` | öffentliche Adresse ohne Slash – für Links in Mails, später auch Kennung in der Suite |
| `TRUST_PROXY_HOPS` | Anzahl eigener Reverse Proxys (für die IP der Drosselung) |
| `CRON_SECRET` | Schutz des Aufräum-Endpunkts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailversand – ohne ist die Online-Buchung abgeschaltet |
| `VERIFY_CODE_SECRET` | HMAC für Bestätigungscodes (mind. 32 Zeichen) |
| `MANAGE_LINK_SECRET`, `MANAGE_LINK_SECRET_PREVIOUS` | Ableitung der Verwaltungslinks, vorheriges für Schlüsselwechsel (mind. 32 Zeichen) |
| `BROADCAST_MAILS_PER_MINUTE` | optional: Tempo der Rundmail-Warteschlange (Standard 30, 1–600) |
| `IMPRESSUM_*` | Angaben für Impressum und Datenschutzerklärung |
| `UPLOAD_DIR` | optional: Ablage hochgeladener Bilder (Standard `data/uploads` im Arbeitsverzeichnis) |

Später kommen dazu: `RSVP_*` (Phase 7), `SUITE_*` (Phase 8), optional
`TURNSTILE_*`.
