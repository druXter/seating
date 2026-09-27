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
| 4b | Warteliste mit befristetem Nachrück-Angebot | ✅ umgesetzt |
| 5 | Modus `SEAT`: Einzelplätze (Kino, Ball) | ✅ umgesetzt |
| 6 | Modus `ASSIGNED`: Sitzordnung (Hochzeit) mit Gästeliste und Drag & Drop, Buchungen im Plan verschieben | ✅ umgesetzt |
| 7 | Anbindung an rsvp-app: Platzwahl über Zusagen, Gästeliste abgleichen, Platzierung zurückmelden | ✅ umgesetzt (Seating-Seite; rsvp-app folgt) |
| 8 | Konto-Föderation über `suite-kit`: mit Konten anderer Tools anmelden, für andere Tools bestätigen | ✅ umgesetzt |

Tische und Einzelplätze lassen sich online buchen (Modus `TABLE` bzw. `SEAT`, Zugang `OPEN` oder nur über eine Zusage
aus rsvp-app), Veranstalter\*innen verwalten die Buchungen im Admin-Bereich. Für eine Sitzordnung (Modus `ASSIGNED`) legen sie die Gäste selbst an und
setzen sie auf Plätze.

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

### Anmelden mit einem Konto aus einem anderen Tool (Föderation)

Optional und nach dem Protokoll von [`suite-kit`](https://github.com/druXter/suite-kit) (Ed25519-signierte
Login-Bestätigungen, kein gemeinsames Geheimnis). Seating kann beides sein:

* **Empfänger** (`SUITE_IDPS`): Die Login-Seite zeigt „Mit … anmelden“ für jedes eingetragene Tool. Beim ersten Login
  entsteht ein Konto ohne Passwort, sofern `autoProvision` für dieses Tool an ist. **Empfohlen für Seating:**
  `autoProvision: false`, weil Konten hier nur Veranstalter\*innen brauchen – dann meldet sich nur an, wer hier schon
  eingeladen wurde und sein Konto unter „Mein Konto“ verknüpft hat. Die Rolle beim ersten Login: Admin nur mit
  `mapAdminRole`, sonst Creator; Moderator\*in bleibt Moderator\*in. Danach vergeben nur lokale Admins Rollen.
* **Anbieter** (`SUITE_SIGNING_KEY`, `SUITE_TRUSTED_APPS`): Andere Tools können Seating-Konten für ihren Login nutzen.
  Bestätigt werden nur Konten mit eigenem Passwort (keine Ketten), nur für die eingetragenen Tools.

Regeln wie in der ganzen Suite: Identität ist (Tool, Konto-ID), **nie die E-Mail** – gibt es hier schon ein Konto mit
derselben Adresse, wird der Login abgelehnt, statt es zu übernehmen. Verknüpft wird bewusst unter „Mein Konto“ aus einer
bestehenden Sitzung; dort lässt sich eine Verknüpfung auch entfernen, außer sie ist die einzige Anmeldemöglichkeit.
Ändert sich die Adresse beim anderen Tool, zieht Seating sie bei rein föderierten Konten beim nächsten Login nach.
Die Kontoverwaltung zeigt, über welches Tool sich ein Konto anmeldet.

Einrichten (Beispiel Seating `https://plaetze.example.de` und rsvp-app `https://rsvp.example.de`, gegenseitig):

```bash
node node_modules/suite-kit/bin/suite-keygen.js   # eigenes Schlüsselpaar, nur in die .env von Seating
```

| Wo | Eintrag |
| --- | --- |
| Seating | `SUITE_SIGNING_KEY=<privater Schlüssel>`, `SUITE_TRUSTED_APPS=https://rsvp.example.de`, `SUITE_IDPS=[{"issuer":"https://rsvp.example.de","label":"rsvp-app","autoProvision":false}]` |
| rsvp-app | `https://plaetze.example.de` in `SUITE_IDPS` (und in `SUITE_TRUSTED_APPS`, wenn rsvp-app Anmeldungen für Seating bestätigen soll) |

`BASE_URL` muss exakt die Adresse sein, unter der die anderen Tools Seating erreichen – sie ist die Kennung (`iss`/`aud`).
Endpunkte: `/.well-known/suite-identity` (Discovery, ohne Schlüssel 404), `/api/suite/authorize` (Anbieter),
`/api/suite/login` und `/api/suite/callback` (Empfänger), `/login/continue` (Zwischenseite, damit ein Login mitten im
Anbieter-Ablauf per echtem Seitenwechsel weitergeht). Ohne `SUITE_*` gibt es weder Buttons noch Endpunkte – Seating
bleibt ein einzelnes Tool.

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
* **Modus:** „Tischbuchung für Gruppen“ (`TABLE`) oder „Einzelplätze“ (`SEAT`, Kino, Ball), jeweils mit Zugang
  `OPEN` oder `RSVP` (nur über eine Zusage aus rsvp-app, siehe unten), oder „Sitzordnung durch Veranstalter\*innen“
  (`ASSIGNED`, Hochzeit) mit Zugang `NONE`. Der Modus lässt sich nur wechseln, solange es keine aktiven Buchungen, Gruppen oder
  Wartelisten-Einträge gibt.
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
  Telefon verpflichtend, Antwortadresse (Reply-To) und Hinweis für die Bestätigungsmail, **Warteliste** (Standard
  an) und wie lange ein Angebot aus der Warteliste gilt (Standard 24 Stunden, 1–168).

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

### Einzelplätze (Modus `SEAT`)

* **Plätze wählen:** im Plan antippen (an/ab) oder – gleichwertig, auch per Tastatur und Screenreader – in der Liste
  ankreuzen (nach Reihe bzw. Tisch gruppiert). „Plätze vorschlagen“ sucht N Plätze nebeneinander: in einer Reihe ohne
  Gang oder Lücke dazwischen, an einem Tisch beliebige Plätze desselben Tisches; gewählt wird der erste Treffer.
  Buchbar sind Plätze aus Reihenblöcken, einzelne Stühle und Plätze an Tischen.
* **Obergrenze** pro Buchung: „Plätze pro Buchung höchstens“ (Standard 10, 1–50). Die Personenzahl ist die Zahl der
  Plätze.
* **Reservieren, Bestätigen, Verfall, `.ics`, Verwaltungslink** wie bei Tischen. Alle Plätze einer Buchung
  entstehen in einer Transaktion – ist einer gerade vergeben worden, scheitert die ganze Buchung am Unique-Index.
  Mails, Kalender und Listen fassen die Plätze kurz zusammen („Reihe A, Plätze 3–5; Tisch 2, Platz 1“).
* **Verwaltungslink:** Plätze neu wählen oder einzelne abgeben, bis zur Änderungsfrist.
* **Admin:** Buchung anlegen und ändern mit derselben Platzwahl, ohne Obergrenze und auch mit nicht buchbaren
  Plätzen; Klick auf einen Platz im Plan führt zur Buchung bzw. zum Anlegen. Liste, CSV und Druckansicht
  (Platzliste, Platzkarten) zeigen die Plätze je Buchung.
* **Warteliste:** Angebote nur für N Plätze nebeneinander. Findet „Plätze vorschlagen“ keine, bietet die Seite die
  Warteliste an. Verstreute Plätze kann der Admin direkt zuweisen.
* **Lückenregel** (keinen einzelnen Platz zwischen zwei Buchungen frei lassen): vorbereitet und getestet
  (`singleGapProblems` in `app/lib/events/seat-rules.ts`), aber noch nicht eingeschaltet – die Seite zeigt nur einen
  Hinweis. Zum Nachrüsten ein Event-Feld plus Checkbox ergänzen und in `gapRuleFor` zurückgeben.

### Sitzordnung (Modus `ASSIGNED`)

Für Veranstaltungen ohne Online-Buchung, bei denen die Veranstalter\*innen festlegen, wer wo sitzt (Hochzeit, Gala).
Seite: `/admin/events/<id>/arrange` („Sitzordnung“).

* **Gäste:** Eine **Gruppe** (z. B. „Familie Muster“ oder eine Einladung mit Begleitungen) hat eine oder mehrere
  **Personen** (höchstens 50) und eine interne Notiz (z. B. Essenswünsche). Anlegen von Hand (eine Person pro Zeile)
  oder als **CSV** – eine Zeile pro Person mit den Spalten `Name` (Pflicht), `Gruppe` (gleiche Gruppe = eine Gruppe)
  und `Notiz`, Trenner Semikolon oder Komma, UTF-8. Erst kommt eine Vorschau, dann wird übernommen; bei einem Fehler
  (mit Zeilennummer) wird nichts übernommen. Ein Import ergänzt immer, er löscht nichts.
* **Keine Kontaktdaten, keine Mails, kein Verwaltungslink:** Gäste bekommen von Seating nichts. Mit einer
  Verknüpfung zu rsvp-app kommen die Gäste per Abgleich und sehen ihren Platz dort (siehe „Anbindung an rsvp-app“). Die Rundmail und „Buchung anlegen“ führen zur
  Sitzordnung.
* **Setzen:** Personen aus der Liste auf einen Platz ziehen (auf einen Tisch gezogen: erster freier Platz daran),
  eine ganze Gruppe mit „zusammen setzen“ – alle ohne Platz kommen an denselben Tisch bzw. nebeneinander in dieselbe
  Reihe, ab dem Zielplatz; passt es nicht, passiert nichts. Auf einen besetzten Platz gezogen, **tauschen** die beiden.
  Zurück in die Liste gezogen, verliert die Person ihren Platz. Nicht buchbare Plätze sind erlaubt.
* **Ohne Ziehen:** Person oder Gruppe antippen und dann den Platz antippen (am Handy scrollt ein Finger weiter die
  Seite), oder – auch per Tastatur und Screenreader – in der Liste wählen und den Platz aus einer Auswahlliste nehmen.
* **Markierungen:** „2 von 4 mit Platz“, Personen ohne Platz farbig, „getrennt: Tisch 1, Tisch 3“, wenn eine Gruppe
  auf mehrere Tische bzw. Reihen verteilt ist. Im Plan stehen die Initialen auf den Plätzen, der volle Name im
  Tooltip; an Tischen „3 von 8“.
* **Gruppe bearbeiten** (`…/bookings/<gruppe>`): Name, Personen umbenennen, entfernen (ihr Platz wird frei) und
  hinzufügen, interne Notiz, „Gruppe hat abgesagt“ (Plätze frei, Gruppe bleibt als storniert), endgültig löschen,
  Verlauf (wer hat wen wann wohin gesetzt).
* **Druckansicht:** Liste je Tisch bzw. Reihe mit den Namen und „ohne Platz“, **Tischkarten** pro Person.
  **CSV-Export:** eine Zeile pro Person (Platz, Name, Gruppe, Status, interne Notiz).
* **Öffentlich:** Die Eventseite zeigt Infos und Plan mit frei/belegt, aber **nie Namen**, und keine Buchung.

### Buchungen im Plan verschieben (Modus `TABLE` und `SEAT`)

Auf derselben Seite („Im Plan verschieben“) lassen sich aktive Buchungen per Drag & Drop umsetzen: einen belegten
Tisch auf einen freien ziehen bzw. im Modus `SEAT` einen belegten Platz auf einen freien (die übrigen Plätze der
Buchung bleiben). Ohne Maus: in der Liste wählen und das Ziel antippen oder aus einer Auswahlliste nehmen. Weil
echte Buchungen samt Mail daran hängen, fragt die Seite **vor dem Verschieben nach**; „Kund\*innen benachrichtigen“
(Standard an) schickt bestätigten Buchungen die Änderungsmail mit neuer `.ics`. Es gelten dieselben Regeln wie im
Ändern-Formular (Kapazität, Konflikterkennung, Audit-Log).

### Anbindung an rsvp-app

Optional und pro Event: Seating übernimmt Zusagen aus einem Termin in rsvp-app (docs/KONZEPT.md Abschnitt 9).
Voraussetzung: `RSVP_SEATING_SECRET` und `RSVP_APP_BASE_URL` sind gesetzt, in rsvp-app dasselbe Secret.

* **Verknüpfen – beide Seiten stimmen zu:** In den Event-Einstellungen die id des rsvp-Termins eintragen. Seating
  zeigt dann den **Sitzplatz-Link** (`https://…/rsvp/<event-id>`), den die Besitzer\*in des Termins in rsvp-app
  einträgt. Erst mit beiden Einträgen gilt die Verknüpfung – so kann kein Seating-Konto mit einer fremden rsvp-id
  eine Gästeliste abrufen.
* **Platzwahl über Zusagen** (Tisch- oder Platzbuchung, Zugang „nur mit Zusage aus rsvp-app“):
  * „Sitzplatz wählen“ in rsvp-app führt mit einem kurz gültigen, signierten Link auf `/rsvp/<event-id>`. Der Aufruf
    ändert nichts; er zeigt passende Tische bzw. die Platzwahl für genau so viele Personen, wie die Zusage hat
    (1 + Begleitung). Name, Adresse und Personenzahl kommen aus rsvp-app.
  * Gebucht wird per Knopf: sofort bestätigt (keine Mail-Bestätigung – die Zusage ist die Bestätigung), mit Adresse
    Bestätigungsmail mit `.ics`. Höchstens eine aktive Buchung pro Zusage; ein erneuter Link führt zur Buchung.
  * Verwaltungsseite: Tisch bzw. Plätze ändern und stornieren; Name und Personenzahl ändern sich nur in rsvp-app.
    Meldet rsvp-app eine andere Personenzahl, zeigen Verwaltungsseite und Buchungsliste einen Hinweis, bis die
    Plätze angepasst sind.
  * **Absage in rsvp-app storniert die Buchung automatisch** (Webhook), mit Storno-Mail und `.ics` CANCEL.
  * Keine Warteliste – dort wartet man in rsvp-app. Die öffentliche Seite zeigt nur den Plan.
* **Sitzordnung** (Modus `ASSIGNED`): „Mit rsvp-app abgleichen“ holt die aktuellen Zusagen und zeigt **neue**,
  **geänderte** (Name, Begleitung dazu/weg) und **nicht mehr zugesagte**. Übernommen wird nur, was ausgewählt ist;
  Absagen sind nicht vorausgewählt – nichts wird still gelöscht. Gruppen aus rsvp-app haben die Personen „Name“ und
  „Begleitung“ (ohne Namen „Begleitung von …“), keine Kontaktdaten; ändern lassen sie sich nur über den Abgleich.
  Meldet rsvp-app eine Änderung, zeigt die Sitzordnung „bitte abgleichen“.
* **Rückmeldung:** Nach jeder Änderung meldet Seating den vollständigen Stand der Platzierungen an rsvp-app
  („Tisch 7, Plätze 3, 4“) – für die Gästeansicht und den Einlass. Best-effort nach der Antwort, dazu „Platzierungen
  erneut an rsvp-app melden“. Vor dem Löschen eines Events geht ein leerer Stand raus.

**Vertrag** (`app/lib/rsvp/token.ts`, Format wie zwischen rsvp-app und Abstimmungstool):
`base64url(JSON).base64url(HMAC-SHA256(payloadPart, secret))`. Jede Nachricht trägt `typ`, `aud` (Origin des
Empfängers), `iat`/`exp` (Unix-Sekunden, höchstens 1 Stunde gültig) sowie `seatingEventId` und `rsvpEventId`.
Identität eines Gasts ist die Zusage (`rsvpId`), nicht die E-Mail.

| Art (`typ`) | Richtung | Weg | Inhalt |
| --- | --- | --- | --- |
| `seat-link` | rsvp-app → Seating | Browser: `GET /rsvp/<seatingEventId>?t=…`, Buchung per POST | `rsvpId`, `name`, `email` (oder null), `companions` (Namen oder null) |
| `rsvp-change` | rsvp-app → Seating | `POST /api/rsvp-webhook`, Body = Nachricht, `text/plain` | `rsvpId`, `attending`, `name`, `email`, `companions` |
| `guest-list-request` | Seating → rsvp-app | `POST <RSVP_APP_BASE_URL>/api/seating/guest-list` | – |
| `guest-list` | rsvp-app → Seating | Antwort darauf, `text/plain` | `guests`: Zusagen (bestätigt, nicht auf der Warteliste) |
| `placements` | Seating → rsvp-app | `POST <RSVP_APP_BASE_URL>/api/seating/placements` | `placements`: vollständiger Stand `{ rsvpId, label }` |

Webhook: 401 bei ungültiger Signatur, falschem Empfänger oder Ablauf; 200 ohne Wirkung für nicht so verknüpfte
Events. Ältere Meldungen als die zuletzt angewandte (`iat`) werden ignoriert.

### Warteliste

* **Eintragen:** Gibt man eine Gruppengröße ein, für die gerade kein passender Tisch frei ist (es aber passende Tische
  gibt), bietet die Seite „Auf die Warteliste“ an: Name, E-Mail, ggf. Telefon, Personenzahl (zweimal), Anmerkung.
  Der Server prüft selbst, dass wirklich nichts frei ist, und drosselt wie beim Reservieren.
* **Bestätigen** per Link oder Code wie beim Buchen, innerhalb von 24 Stunden – erst dann zählt der Eintrag. Die Mail
  „Du stehst auf der Warteliste“ enthält den persönlichen Link zum Austragen.
* **Eine Buchung pro Adresse** zählt Einträge der Warteliste mit (ohne Hinweis auf der Seite, wie beim Buchen).
* **Angebot:** Wird ein Tisch frei, geht er an den am längsten wartenden Eintrag, zu dem er passt (Gruppengröße und
  Mindestbelegung; kleinste freie Tische zuerst). Der Tisch ist dann für die Gruppe reserviert (Status „Angebot“,
  öffentlich belegt), die Mail verlinkt die persönliche Seite mit „Angebot annehmen“ und „ablehnen“ (Buttons, GET
  ändert nichts). Die Frist ist die eingestellte Zahl Stunden, höchstens bis Buchungsschluss.
* **Annehmen** → bestätigte Buchung mit Bestätigungsmail und `.ics`. **Ablehnen** oder **nicht reagiert** → der
  Eintrag endet (bei Verfall mit Mail) und der Tisch geht sofort an den nächsten passenden Eintrag.
* **Angestoßen** wird das bei jedem Ereignis, das einen Tisch frei machen kann (Storno, Tischwechsel, Löschen,
  Planänderung, Einstellungen, bestätigter Eintrag), und von einem **Hintergrund-Durchlauf** im Serverprozess
  (`SWEEP_INTERVAL_SECONDS`, Standard jede Minute), der abgelaufene Reservierungen und Angebote bemerkt. Der Cron macht
  dasselbe zusätzlich. Angebote gibt es nur, solange das Event buchbar ist.
* **Admin:** Filter „Warteliste“ in der Buchungsliste (Reihenfolge und „seit“), Tisch direkt zuweisen (am
  Nachrück-Verfahren vorbei, sofort bestätigt), offenes Angebot für die Gruppe annehmen, Eintrag beenden oder löschen.
* Angebots- und Verfallsmails laufen über die Mail-Warteschlange (in derselben Transaktion eingereiht wie das Angebot
  selbst, damit keine verloren geht), vor Rundmails.

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
* **Föderation** (`app/api/suite/*`): Bestätigungen gelten 60 s, nur zusammen mit dem einmaligen `state`-Cookie
  desselben Browsers (`__Host-suite-state`, 10 Minuten, wird bei jedem Rücksprung gelöscht); Signatur, Anbieter, Empfänger
  und `nonce` werden geprüft, der genaue Ablehnungsgrund steht nur im Server-Log. Unbekannte Schlüssel-ID: Discovery
  höchstens einmal pro Minute neu laden (Schlüsselrotation). Antworten mit `no-store` und `no-referrer`.
* **Reservierte Adressen:** Events liegen unter `/<slug>`. Alle Pfade des Tools stehen in `app/lib/slugs.ts`;
  ein Test schlägt fehl, sobald eine neue Route dort fehlt.

### Buchungen verwalten (Veranstalter\*innen)

Besitzer\*in, Admins und Konten mit Freigabe (auch Moderator\*innen) verwalten die Buchungen eines Events. Jede Aktion
prüft auf dem Server Konto, Zugriff auf das Event und dass die Buchung zu genau diesem Event gehört.

* **Plan auf der Event-Seite:** Klick auf einen belegten Tisch öffnet die Buchung, auf einen freien „Buchung anlegen“
  mit vorausgewähltem Tisch. Verschieben per Ziehen: siehe „Buchungen im Plan verschieben“.
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
                    # Mail-Bausteine (Maskierung), Warteliste (Zuteilung, Frist, Wahl), Platzregeln
                    # (nebeneinander, Vorschlag, Lückenregel, Kurzform der Platznamen), CSV lesen,
                    # Sitzordnung (Gruppen-Formulare, Gäste-CSV, Gruppe zusammen setzen, „getrennt“,
                    # Initialen), rsvp-app-Vertrag (Signatur, typ/aud/exp, Inhalte), Abgleich-Regeln,
                    # Föderation (Rollen beim ersten Login, Ziel der Zwischenseite, state-Cookie, Konfiguration)
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
* Warteliste:
  * eintragen nur ohne freien passenden Tisch, zu große Gruppen, Bestätigung per Code und per Link (GET bestätigt
    nicht), eine pro Adresse, nachgespielter Eintrag trotz freiem Tisch;
  * Angebot an den ältesten passenden Eintrag (größere Gruppe übersprungen), annehmen, ablehnen → der Nächste;
  * Verfall per Cron mit Mail → der Nächste, abgelaufenes Angebot nicht annehmbar, 6 gleichzeitige Durchläufe
    → genau ein Angebot;
  * austragen, Warteliste abgeschaltet, Admin (Reihenfolge, direkt zuweisen, beenden, fremdes Konto).
* Einzelplätze: Vorschlag, Plan (Mausklick) und Liste, reservieren und bestätigen, Mails und `.ics` mit Plätzen,
  8 gleichzeitige Buchungen mit überlappenden Plätzen (genau eine gewinnt), Obergrenze, erfundene, belegte und nicht
  buchbare Plätze, Plätze tauschen und abgeben über den Verwaltungslink, Moduswechsel gesperrt, Admin (anlegen mit
  verstreuten Plätzen, ändern, Platzliste), Warteliste nur für zusammenhängende Plätze.
* Sitzordnung: Modus wählen, Gruppe anlegen, CSV mit Vorschau und fehlerhafter Datei, mit der Maus Person setzen,
  Gruppe zusammen setzen, tauschen, auf einen Tisch ziehen, vom Platz nehmen, Gruppe passt nicht; antippen und
  Auswahlliste (Tastatur), Escape; Gruppe bearbeiten (Platz wird frei), absagen, Druck, Tischkarten, Export pro
  Person; öffentlich keine Namen im HTML, kein Verwaltungslink; nachgespielte Aufrufe mit veraltetem Stand, Person
  eines fremden Events, fremdes Event, Konto ohne und mit Freigabe (Positivkontrolle), ohne Sitzung, ungültiger
  Platz, falscher Modus.
* Verschieben im Plan: belegtes Ziel, Abbrechen, Rückfrage mit Änderungsmail, ohne Mail, zu kleiner Tisch, veralteter
  Stand, Buchung eines fremden Events; Einzelplatz per Auswahlliste.
* Anbindung an rsvp-app (gegen ein Test-Doppel, `tests/e2e/rsvp-server.ts`): Einstellungen (Pflichtfeld,
  Sitzplatz-Link, Verknüpfung nicht wechselbar bei aktiven Buchungen), Tischwahl über Zusage (GET ändert nichts,
  Mail, Rückmeldung, erneuter Link öffnet die Buchung, Tischwechsel), Platzwahl mit genau N Plätzen und geänderter
  Begleitung per Webhook, Absage storniert mit Mail, ältere Meldung ignoriert, ungültige Signatur/Empfänger/Ablauf
  und fremde Verknüpfung ohne Wirkung; Link abgelaufen, zu lange gültig, falscher Empfänger, falsches Secret, anderes
  Event, nicht verknüpft, offener Zugang, manipulierter Inhalt, doppelt gleichzeitig (Positivkontrolle);
  Sitzordnung: Abgleich neu/geändert/abgesagt mit Auswahl, Platzierung zurückgemeldet, von Hand angelegte Gruppen
  unberührt, nicht verknüpft in rsvp-app, fremdes Konto.
* Berechtigung: Moderator\*in, fremdes Konto, Buchung eines anderen Events, ohne Sitzung.
* Druckansicht.
* Konto-Föderation (gegen zwei Test-Doppel anderer Tools, `tests/e2e/suite-server.ts`): erster Login legt ein Konto an
  (Admin dort wird hier Creator, Moderator\*in bleibt), erneuter Login in anderem Browser mit nachgezogener Adresse,
  ohne `autoProvision` kein Konto, vorhandene Adresse → abgelehnt statt zusammengeführt, Verknüpfen aus „Mein Konto“
  und Login darüber, dieselbe Identität für ein zweites Konto abgelehnt, Entfernen (nicht die letzte Anmeldemöglichkeit;
  Positivkontrolle mit Passwort; fremde Verknüpfung per gefälschtem Formular), Wiedergabe der Bestätigung im selben und
  in einem fremden Browser, manipulierte Signatur/Empfänger/`nonce`/Anbieter, unbekannter Schlüssel, nicht
  konfigurierter Anbieter; als Anbieter: Discovery, nicht freigegebenes Tool, Login mit Fortsetzung über die
  Zwischenseite und gültiger Bestätigung, keine Ketten, Zwischenseite nur zum eigenen Endpunkt.

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
| `BASE_URL` | öffentliche Adresse ohne Slash – für Links in Mails und zugleich Kennung in der Suite |
| `TRUST_PROXY_HOPS` | Anzahl eigener Reverse Proxys (für die IP der Drosselung) |
| `CRON_SECRET` | Schutz des Aufräum-Endpunkts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailversand – ohne ist die Online-Buchung abgeschaltet |
| `VERIFY_CODE_SECRET` | HMAC für Bestätigungscodes (mind. 32 Zeichen) |
| `MANAGE_LINK_SECRET`, `MANAGE_LINK_SECRET_PREVIOUS` | Ableitung der Verwaltungslinks, vorheriges für Schlüsselwechsel (mind. 32 Zeichen) |
| `BROADCAST_MAILS_PER_MINUTE` | optional: Tempo der Mail-Warteschlange (Standard 30, 1–600) |
| `SWEEP_INTERVAL_SECONDS` | optional: Hintergrund-Durchlauf für Verfall und Angebote (Standard 60, 0 = aus) |
| `IMPRESSUM_*` | Angaben für Impressum und Datenschutzerklärung |
| `RSVP_SEATING_SECRET`, `RSVP_APP_BASE_URL` | optional: Anbindung an rsvp-app (gemeinsames Secret, mind. 32 Zeichen; Adresse von rsvp-app) |
| `SUITE_IDPS`, `SUITE_SIGNING_KEY`, `SUITE_SIGNING_KEY_PREVIOUS`, `SUITE_TRUSTED_APPS`, `SUITE_APP_NAME` | optional: Konto-Föderation (siehe [oben](#anmelden-mit-einem-konto-aus-einem-anderen-tool-föderation) und README von `suite-kit`) |
| `UPLOAD_DIR` | optional: Ablage hochgeladener Bilder (Standard `data/uploads` im Arbeitsverzeichnis) |

Später evtl.: `TURNSTILE_*` (Bot-Schutz für das Buchungsformular).
