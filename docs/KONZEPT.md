# Seating – Konzept

Sitzplatz-Tool der App-Suite (siehe `suite-kit`). Wie alle Tools der Suite **eigenständig zuerst**: eigene Datenbank,
eigene Admin-Konten, eigenes Deployment. Anbindung an rsvp-app und Konto-Föderation sind optionale Zusätze.

Dieses Dokument ist die fachliche Grundlage. Alles unter "Offene Entscheidungen" ist noch nicht festgelegt.

---

## 1. Szenarien → zwei unabhängige Achsen

Statt pro Szenario eine eigene Logik zu bauen, hat jedes Event einen **Modus** (wer wählt was) und einen **Zugang**
(wer darf überhaupt buchen). Die Szenarien sind Kombinationen daraus.

| Modus | Wer wählt | Buchbare Einheit | Typisch |
| --- | --- | --- | --- |
| `TABLE` | Kund*in | ganzer Tisch für eine Gruppe | Tischreservierung für Gruppen |
| `SEAT` | Kund*in | einzelne Plätze (N Stück pro Buchung) | Kino, Winterball |
| `ASSIGNED` | nur Admin | einzelne Plätze, Personen werden zugeordnet | Hochzeit, Gala mit Sitzordnung |

| Zugang | Bedeutung | Mail-Verifizierung |
| --- | --- | --- |
| `OPEN` | Jede*r mit Link zum Event | ja, per Code/Link |
| `RSVP` | Nur mit gültiger Zusage aus einem verknüpften rsvp-app-Event | nein – Adresse ist durch rsvp-app bereits bestätigt |
| `NONE` | Keine Selbstbuchung (nur bei `ASSIGNED`) | – |

| Szenario | Modus | Zugang |
| --- | --- | --- |
| Tischbuchung für Gruppen | `TABLE` | `OPEN` (optional `RSVP`) |
| Kino | `SEAT` | `OPEN` |
| Winterball | `SEAT` | `RSVP` |
| Hochzeit | `ASSIGNED` | `NONE` (Gästeliste aus rsvp-app importiert) |

Der Admin kann in **allen** Modi Buchungen anlegen, verschieben, ändern und löschen.

---

## 2. Raumplan

### Vorlage und Event-Plan

* **Vorlagen** (`FloorPlan`) sind wiederverwendbare Raumpläne ("Festsaal", "Hörsaal M001").
* Beim Anlegen eines Events wird die Vorlage **kopiert** (Snapshot). Spätere Änderungen an der Vorlage verändern keine
  laufenden Events – sonst könnten gebuchte Tische verschwinden.
* Der Event-Plan ist danach separat bearbeitbar. Sobald Buchungen existieren, prüft der **Server**: belegte Einheiten
  dürfen nicht gelöscht, nicht unter die belegte Kapazität verkleinert und nicht auf „nicht buchbar“ gesetzt werden
  (Letzteres ergänzt in Phase 2). Umbenennen und Verschieben geht immer. Umgesetzt in `app/lib/events/save-layout.ts`
  (eine Transaktion: Version prüfen, abgelaufene Holds verfallen lassen, prüfen, Units abgleichen); zusätzlich
  verhindert die Datenbank das Löschen einer belegten Einheit (`Allocation.unit` mit `onDelete: NoAction`).
* „Plan aus Vorlage neu übernehmen“ (Phase 2): holt Plan und Hintergrundbild der Vorlage erneut, mit denselben
  Prüfungen. Nur für Konten, die die Vorlage selbst sehen dürfen.

### Elemente

| Typ | Beschreibung |
| --- | --- |
| `table` | rund, rechteckig, oval; Plätze werden automatisch rundherum erzeugt (Anzahl einstellbar, einzelne Seiten abschaltbar, z. B. Tafel an der Wand) |
| `seat` | einzelner Stuhl |
| `seatBlock` | Reihen-Generator (Kino/Saal): Reihen × Plätze, Reihenbeschriftung (A, B, …), Lücken/Gänge, Krümmung optional |
| `static` | nicht buchbar: Bühne, Tanzfläche, Bar, Buffet, Tür, Säule, Text-Label |
| Hintergrund | optional ein hochgeladener Grundriss als Unterlage (Deckkraft einstellbar) |

* Koordinaten in abstrakten Einheiten (Vorschlag: 1 Einheit = 1 cm), Darstellung als **SVG mit viewBox** – skaliert
  sauber, lässt sich stylen, drucken und für Screenreader beschriften.
* Jede buchbare Einheit hat einen **stabilen, unveränderlichen Schlüssel** (`key`, z. B. `t12`, `t12-s3`, `s5`,
  `blk1-r1-s12`) und ein frei änderbares **Label** ("Tisch 12", "Reihe A, Platz 12"). Buchungen referenzieren die
  Einheit, nie das Label. Plätze in Reihenblöcken bekommen ihren Schlüssel aus der **Position** (Reihe von vorne, Platz
  von links), nicht aus der Beschriftung – sonst würde eine geänderte Reihenzählung (A → C) Schlüssel verschieben
  (umgesetzt in Phase 1, `app/lib/floorplan/units.ts`). Element-Nummern laufen nur vorwärts (`nextId`); eine gelöschte
  Nummer wird nie neu vergeben.
* Import/Export als JSON mit `schemaVersion`, damit Pläne zwischen Instanzen wandern können. Format und Prüfregeln
  (zod): `app/lib/floorplan/schema.ts`. Ein Import legt immer einen neuen Plan an; das Hintergrundbild gehört nicht zur
  Datei.
* **Sichtbarkeit:** Pläne sind privat (besitzendes Konto und Admins). Jeder Plan lässt sich als **gemeinsame
  Vorlage** anbieten – andere Creator können ihn dann ansehen, exportieren und duplizieren, aber nicht ändern.
* **Hintergrundbild:** PNG/JPEG/WebP bis 5 MB, Dateiart am Inhalt erkannt (kein SVG), abgelegt als Datei mit
  Zufallsnamen außerhalb von `public/`, ausgeliefert nur an Konten mit Zugriff. Upload über einen Route Handler statt
  einer Server Action, damit das 1-MB-Limit der Server Actions für alle anderen Formulare bestehen bleibt.

### Editor (Admin)

Auswählen, Ziehen, Drehen, Duplizieren, Mehrfachauswahl, Raster mit Einrasten, Rückgängig/Wiederholen, Zoom/Pan.
Tastatursteuerung für Feinjustierung (Pfeiltasten). Kein schwergewichtiges Canvas-Framework nötig; SVG + Pointer Events
reicht für die zu erwartende Elementzahl (ein paar hundert).

### Kundenansicht

* Plan mit Zoom/Pan, touchtauglich (die meisten buchen am Handy).
* Nach Eingabe der Gruppengröße werden **passende** Tische hervorgehoben, unpassende abgeblendet.
* Status nicht nur über Farbe (zusätzlich Muster/Symbol + Text), Legende.
* **Listenansicht** als gleichwertige Alternative ("Tisch 5 · 8 Plätze · frei") – für Barrierefreiheit und kleine
  Bildschirme.
* Umgesetzt in Phase 2 (`app/[slug]`): Zoom/Pan mit „kooperativen“ Gesten (ein Finger scrollt die Seite, zwei Finger
  zoomen/verschieben, Maus zieht, Strg + Mausrad zoomt). Öffentlich nur frei / belegt / nicht buchbar – bestätigt und
  unbestätigt sehen gleich aus. Entwurf und Archiv ergeben 404, Konten mit Zugriff sehen eine Vorschau.
* **Einbettbar** per iFrame wie in rsvp-app (`frame-ancestors *`, kein `X-Frame-Options`), nicht indexiert
  (`noindex`). Fest im Code, weil Next.js die Header beim Build festschreibt – eine Env-Variable würde im Container
  nicht greifen. Alle übrigen Seiten bleiben `frame-ancestors 'none'`.

---

## 3. Datenmodell (Entwurf)

Pseudo-Schema, Feldnamen englisch. Konten-Tabellen (`User`, `Session`, `ExternalIdentity`, `LoginThrottle`) wie in der
Referenzimplementierung (Abstimmungstool).

Felder kommen mit der Phase, die sie nutzt (umgesetzt: `FloorPlan` in Phase 1; `Event` mit den Feldern für
Anzeige, Status, Buchungszeitraum und `minFillRatio`, `EventAccess`, `Unit`, `Booking`/`Allocation` im Kern in
Phase 2; Buchungs-Einstellungen, Verifizierung, Verwaltungslink, `MailLog`, `AuditLog`, `BookingThrottle` in
Phase 3; `adminNote`, `externalRef` und die Warteliste folgen mit ihren Phasen). Zusätzlich zum
Entwurf: `Event.replyTo`, `Event.mailNote`, `Booking.pendingIpHash`.

```text
FloorPlan        id, name, ownerId?, shared (bool), layout (JSON), version (int, für Konflikterkennung),
                 backgroundFile?, backgroundType?, createdAt, updatedAt   -- umgesetzt in Phase 1

Event            id, slug (unique), title, description, location,
                 startsAt, endsAt, timezone ("Europe/Berlin"),
                 mode (TABLE|SEAT|ASSIGNED), access (OPEN|RSVP|NONE),
                 status (DRAFT|OPEN|CLOSED|ARCHIVED),
                 bookingOpensAt?, bookingClosesAt?,
                 selfEditHoursBefore,        -- Selbständerung bis startsAt − N h (Standard 24, 0 = bis Beginn)
                 oneBookingPerEmail (bool),  -- Standard true, siehe Abschnitt 4
                 pendingTtlMinutes,          -- Verfall unbestätigter Buchungen
                 minFillRatio?,              -- TABLE: z. B. 0.5 → 8er-Tisch ab 4 Personen
                 maxSeatsPerBooking?,        -- SEAT
                 requirePhone (bool),
                 waitlistEnabled (bool), offerTtlHours,   -- Warteliste, siehe Abschnitt 5
                 layout (JSON, Snapshot), layoutVersion,
                 backgroundFile?, backgroundType?,   -- eigene Kopie des Bilds der Vorlage
                 ownerId?, sourcePlanId?     -- Besitz (wie FloorPlan) und "aus Vorlage X" (nur Info)
                 rsvpLink (JSON?)            -- Verknüpfung zu rsvp-app, siehe Abschnitt 9

EventAccess      id, eventId, userId, createdAt   UNIQUE(eventId, userId)   -- Freigabe, analog PollAccess

Unit             id, eventId, key, kind (TABLE|SEAT), label,
                 tableKey?  (Platz gehört zu Tisch), capacity (Tisch) | 1 (Platz),
                 bookable (bool)
                 UNIQUE(eventId, key)

Booking          id, eventId, status (PENDING|CONFIRMED|CANCELLED|EXPIRED|WAITLISTED|OFFERED),
                 source (PUBLIC|RSVP|ADMIN),
                 name, email, phone?, partySize, note?, adminNote?,
                 emailVerifiedAt?, expiresAt?,             -- nur bei PENDING
                 verifyTokenHash?, verifyCodeHmac?, verifyAttempts,   -- siehe Abschnitt 6
                 manageTokenVersion (int),                 -- siehe Abschnitt 6
                 icsSequence (int),
                 externalRef?  (z. B. rsvp:<eventId>:<guestId>),
                 createdAt, updatedAt, cancelledAt?

Allocation       id, eventId, unitId, bookingId, attendeeName?
                 UNIQUE(eventId, unitId)                   -- DIE Garantie gegen Doppelbuchung

MailLog          id, bookingId?, eventId, type, recipient, status, error?, createdAt
AuditLog         id, eventId, bookingId?, actor (userId|"customer"|"system"), action, diff (JSON), createdAt
BookingThrottle  analog LoginThrottle (IP / E-Mail)
```

* `TABLE`: eine Allocation auf die Tisch-Einheit.
* `SEAT`/`ASSIGNED`: eine Allocation pro Platz, optional mit `attendeeName` (Hochzeit: "Oma Erna", "Begleitung von Max").
* `eventId` steht in `Allocation` redundant, damit der Unique-Index pro Event greift.
* **Gemischte Belegung** verhindern: Ist ein Tisch als Ganzes vergeben, sind seine Plätze belegt und umgekehrt. Das prüft
  die Buchungslogik (im Modus `TABLE` gibt es ohnehin nur Tisch-Einheiten, im Modus `SEAT` nur Plätze).

---

## 4. Ablauf Tischbuchung (`TABLE` + `OPEN`)

1. Kund*in öffnet `domain.de/<slug>`, sieht Plan und Eventinfos.
2. Gibt Gruppengröße an → passende Tische werden hervorgehoben (`partySize ≤ capacity` und ggf.
   `partySize ≥ ceil(capacity × minFillRatio)`).
3. Wählt Tisch, gibt Kontaktdaten ein: Name, E-Mail, ggf. Telefon, **Gruppengröße erneut** zur Kontrolle, optional
   Anmerkung, Zustimmung Datenschutzhinweis.
4. Server legt Buchung `PENDING` an, **reserviert den Tisch sofort** bis `expiresAt = now + pendingTtlMinutes` und schickt
   die Verifizierungsmail (Link **und** 6-stelliger Code). Die Seite zeigt: "Tisch 12 ist bis 14:30 für dich reserviert –
   bitte bestätige deine Adresse."
5. Bestätigung per Link **oder** Code-Eingabe auf der Seite.
   * **Der Link bestätigt nicht per GET.** Mail-Scanner (Outlook Safe Links, Uni-Mailfilter) rufen Links vorab auf.
     Der Link öffnet eine Seite mit Button "Buchung bestätigen" → POST.
6. Buchung wird `CONFIRMED`, Verifizierungstoken/-code werden gelöscht, Bestätigungsmail mit `.ics` und persönlichem
   Verwaltungslink geht raus.
7. Über den Verwaltungslink (bis `startsAt − selfEditHoursBefore`): Gruppengröße ändern (innerhalb der Tischregeln), auf freien Tisch
   wechseln, Name/Telefon/Anmerkung ändern, stornieren. **E-Mail nicht änderbar.**

Regeln:

* Pro E-Mail höchstens eine aktive (`PENDING` oder `CONFIRMED`) Buchung je Event – Voreinstellung, pro Event abschaltbar
  (`oneBookingPerEmail`), z. B. wenn Firmen oder Vereine mehrere Tische buchen. Geprüft in derselben Transaktion wie
  die Buchung (eine teilweise eindeutige Bedingung "nur aktive Buchungen" kann Prisma für SQLite nicht ausdrücken).
  Die Meldung verrät nicht, ob die Adresse schon gebucht hat, sondern verweist auf die Mail mit dem Verwaltungslink.
* Kund*innen ändern und stornieren selbst bis `startsAt − selfEditHoursBefore` (Standard 24 h, pro Event anpassbar,
  0 = bis Beginn). Bewusst als Abstand statt als fester Zeitpunkt gespeichert, damit die Frist mitwandert, wenn der
  Admin das Event verschiebt. Danach nur noch über den Admin.
* Unbestätigte Buchungen blockieren den Tisch – deshalb Drosselung (pro IP und pro E-Mail, wie Login-Drosselung der Suite)
  und eine Obergrenze gleichzeitiger `PENDING`-Buchungen pro IP. Hinter Cloudflare optional Turnstile.
* Verfallene Buchungen werden `EXPIRED`, der Tisch wird frei (siehe Abschnitt 5). Optional kurze Info-Mail.

Die Modi `SEAT` und Zugang `RSVP` nutzen denselben Ablauf mit anderer Einheit bzw. ohne Schritt 4–5.

Umgesetzt in Phase 3 (`app/lib/events/booking.ts`), mit diesen Festlegungen:

* Standardwerte: `pendingTtlMinutes` 30 (5–1440), `selfEditHoursBefore` 24, `oneBookingPerEmail` an. Buchbar bis
  `bookingClosesAt` bzw. spätestens bis Beginn.
* Drosselung (eigene Tabelle `BookingThrottle`): Reservieren 10/IP und 5/E-Mail je Stunde, Code 30/IP je 15 Minuten,
  erneut senden 3/Buchung und 10/IP je Stunde; höchstens 3 gleichzeitig unbestätigte Reservierungen pro IP und Event
  (`Booking.pendingIpHash`, SHA-256 der IP, nur bis zur Bestätigung bzw. zum Verfall).
* **Mailversand gescheitert:** Die Reservierung wird sofort freigegeben (`EXPIRED`), sonst hinge ein Tisch an einer Mail,
  die nie ankommt. Ohne SMTP oder ohne Secrets ist das Buchen ganz abgeschaltet.
* Nach dem Reservieren zeigt die Seite Frist, Code-Feld und „erneut senden“ als Ergebnis der Server Action (ohne
  Cookie); nach dem Neuladen geht es über die Mail weiter.
* **`oneBookingPerEmail` ohne Hinweis auf der Seite:** Hat die Adresse schon eine aktive Buchung, wird nichts reserviert,
  die Seite antwortet aber wie bei Erfolg (mit Schein-id), und die Adresse bekommt eine Mail mit dem Link zur bestehenden
  Buchung. Bewusst hingenommene Restrisiken: Wer danach den Plan neu lädt, sieht den Tisch weiter frei; bei der
  Schein-id sperrt die Code-Eingabe nach 5 Versuchen nicht. Beides verrät nur mit Aufwand, dass eine Adresse gebucht hat.
* Selbständerung über den Verwaltungslink: Name, Telefon, Anmerkung, Personenzahl (im Rahmen der Tischregeln) und
  Tisch (Auswahl aus eigenem und freien Tischen, Wechsel in einer Transaktion mit demselben Unique-Index), Storno.
* Veranstalter*innen sehen bis Phase 4 eine Buchungsliste nur zum Lesen auf der Event-Seite.

---

## 5. Nebenläufigkeit und Verfall

* Der **Unique-Index auf `Allocation(eventId, unitId)`** ist die eigentliche Sicherung. Keine "erst prüfen, dann
  schreiben"-Logik als alleinige Absicherung – zwei gleichzeitige Anfragen würden beide durchkommen.
* Buchen in **einer Transaktion**:
  1. abgelaufene `PENDING`-Buchungen, die eine der gewünschten Einheiten halten, auf `EXPIRED` setzen und deren
     Allocations löschen,
  2. Allocations einfügen,
  3. bei Unique-Verletzung: Abbruch, freundliche Meldung "wurde gerade vergeben", Plan neu laden.
* Belegt gilt eine Einheit, wenn sie eine Allocation hat, deren Buchung `CONFIRMED` ist oder `PENDING` mit
  `expiresAt > now`. Abgelaufenes wird also schon **beim Lesen** ignoriert; der Cron räumt nur auf.
* Cron `/api/cron/cleanup` (wie in der Suite): abgelaufene `PENDING` → `EXPIRED`, Löschfristen umsetzen.
* Die optionale Info-Mail beim Verfall wird **nicht** verschickt (entschieden in Phase 3): Wer nicht bestätigt, hat
  meist kein Interesse mehr, und jede zusätzliche Mail an eine womöglich falsche Adresse ist unnötig.
* Erneutes Senden der Verifizierung (Kund*in oder Admin): neuer Token/Code, alter wird ungültig, Versuchszähler auf 0.
  **Durch die Kund*in verlängert es den Verfall nicht** – sonst ließe sich ein Tisch durch wiederholtes Anfordern
  beliebig lange blockieren. Der Admin kann beim erneuten Senden wählen, ob `expiresAt` neu gesetzt wird (Phase 4).

### Warteliste (eigener Schritt nach Phase 4)

Angelehnt an rsvp-app (Nachrücken in Reihenfolge der Anmeldung, Admin kann direkt zulassen), aber mit **Angebot statt
automatischer Zuteilung**: Ein frei werdender Tisch ist ein bestimmter Tisch, den die Gruppe nicht selbst ausgesucht hat
– und eine Gruppe, die längst andere Pläne hat, würde ihn sonst leer stehen lassen. Pro Event abschaltbar
(`waitlistEnabled`).

1. **Eintragen:** Ist kein passender Tisch frei, kann man sich mit Name, E-Mail und Gruppengröße eintragen. Bei Zugang
   `OPEN` mit derselben Mail-Verifizierung wie beim Buchen; erst danach gilt der Eintrag (`WAITLISTED`, ohne Allocation).
   `oneBookingPerEmail` zählt Wartelisten-Einträge mit.
2. **Angebot:** Wird eine Einheit frei (Storno, Verfall, Löschen, Admin vergrößert/ergänzt den Plan), bekommt der am
   längsten wartende Eintrag, **für den sie passt** (Gruppengröße und `minFillRatio`), ein Angebot: Die Buchung wird
   `OFFERED`, erhält die Allocation (Unique-Index wie immer die Garantie) und `expiresAt = now + offerTtlHours`. Mail mit
   Link zur Annahme (Seite mit Button, POST – GET verändert nichts).
3. **Annehmen** → `CONFIRMED`, Bestätigungsmail mit `.ics` und Verwaltungslink wie bei einer normalen Buchung.
   **Nicht reagiert** → `EXPIRED`, Allocation weg, das Angebot geht an den nächsten passenden Eintrag. Ausdrücklich
   **ablehnen** geht ebenfalls (Eintrag endet).
4. **Admin:** kann einem Eintrag direkt einen Tisch zuweisen (auch am Nachrück-Verfahren vorbei), Einträge löschen und
   die Reihenfolge einsehen. Da passende Einträge vorgezogen werden, können große Gruppen länger warten – das sieht der
   Admin in der Liste.
5. Belegt ist eine Einheit auch durch `OFFERED` mit `expiresAt > now` (gleiche Regel wie `PENDING`). Der Cron setzt
   abgelaufene Angebote auf `EXPIRED` und stößt das nächste Angebot an; zusätzlich passiert das sofort bei jedem Ereignis,
   das eine Einheit frei macht.

* **`SEAT`:** Das Angebot gilt für N konkrete Plätze. Welche (möglichst nebeneinander), wird mit Phase 5 entschieden.
* **Zugang `RSVP`:** keine eigene Warteliste – dort wartet man in rsvp-app; wer nachrückt, kommt über den normalen Weg
  (Abschnitt 9 A) zur Platzwahl.

---

## 6. Links und Tokens

| Token | Erzeugung | Speicherung | Gültigkeit |
| --- | --- | --- | --- |
| Verifizierungslink | 32 Byte Zufall | nur SHA-256-Hash | einmalig, bis `expiresAt` |
| Verifizierungscode | 6 Ziffern | `HMAC-SHA256(VERIFY_CODE_SECRET, bookingId ":" code)` | max. 5 Versuche, dann neuer Code nötig |
| Verwaltungslink | `HMAC-SHA256(MANAGE_LINK_SECRET, bookingId ":" manageTokenVersion)` | **gar nicht** | bis Storno / Löschung |

**Warum der Verwaltungslink abgeleitet statt gespeichert wird:** Er muss in *jeder* späteren Mail wieder auftauchen
(Änderungsmail, Rundmail, neue `.ics`). Ein nur als Hash gespeicherter Zufallstoken ließe sich nicht erneut versenden,
ohne den alten Link (und damit den Link in bereits importierten Kalendereinträgen) zu entwerten. Die HMAC-Variante ist
reproduzierbar, ein reiner Datenbank-Abzug verrät keine Links, und "Link neu erzeugen" (Admin) erhöht einfach
`manageTokenVersion`. Für Schlüsselrotation `MANAGE_LINK_SECRET_PREVIOUS` beim Prüfen mit akzeptieren.

**Warum der Code per HMAC statt als reiner Hash gespeichert wird:** Es gibt nur 10⁶ sechsstellige Codes. Aus einem
reinen SHA-256-Hash ließe sich der Code bei einem Datenbank-Abzug in Millisekunden zurückrechnen; das Versuchslimit
schützt nur den Online-Weg. Mit dem Server-Secret (liegt nicht in der Datenbank) geht das nicht. Die `bookingId` im
HMAC sorgt dafür, dass gleiche Codes verschiedener Buchungen verschieden aussehen. Rotation ist unkritisch: Ein neues
Secret entwertet nur gerade offene Codes, der Verifizierungslink funktioniert weiter. Der Verifizierungslink selbst
bleibt ein reiner SHA-256-Hash – bei 32 Byte Zufall ist Zurückrechnen ausgeschlossen.

URL-Form: `/b/<bookingId>/<token>`, Verifizierungslink `/verify/<bookingId>/<token>`. Vergleich mit konstanter
Laufzeit. Secrets müssen mindestens 32 Zeichen lang sein; fehlt eins, ist das Buchen abgeschaltet (umgesetzt in
Phase 3, `app/lib/booking-tokens.ts`). Verwaltungsseite mit
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `frame-ancestors 'none'`.

---

## 7. E-Mails und `.ics`

| Anlass | Empfänger | Anhang |
| --- | --- | --- |
| Verifizierung (auch erneut ausgelöst) | Buchende*r | – |
| Buchung bestätigt | Buchende*r | `.ics` (PUBLISH) |
| Änderung durch Kund*in | Buchende*r | `.ics` (SEQUENCE + 1) |
| Änderung durch Admin (verschoben, Personenzahl, Kontakt) | Buchende*r, mit Gegenüberstellung alt → neu | `.ics` (SEQUENCE + 1) |
| Stornierung (durch wen auch immer) | Buchende*r | `.ics` (CANCEL) |
| Verfallen (optional) | Buchende*r | – |
| Wartelisten-Eintrag bestätigt | Wartende*r | – |
| Nachrück-Angebot (mit Frist) | Wartende*r | – |
| Angebot verfallen | Wartende*r | – |
| Rundmail | gefilterte Buchende | optional aktuelle `.ics` |
| Hinweis „bereits gebucht“ (`oneBookingPerEmail`, Phase 3) | Adresse mit bestehender Buchung | – |

* Jede Mail enthält den persönlichen Verwaltungslink (außer der Verifizierungsmail).
* Admin-Änderungen: Checkbox "Kund*in benachrichtigen", standardmäßig an.
* **Rundmail:** Einzelmails (kein BCC), damit jede*r den eigenen Link bekommt. Empfängerfilter (bestätigt / auch
  unbestätigt / einzelne Tische), Vorschau, Testversand an sich selbst, Versand gedrosselt über eine einfache
  Warteschlange, Ergebnis im `MailLog`.
* HTML + Klartext-Teil. **Abweichung (Phase 3):** Pro Event konfigurierbar ist nur das Reply-To (`Event.replyTo`), dazu
  ein freier Hinweis in der Bestätigungsmail (`Event.mailNote`). Der Absender bleibt `SMTP_FROM` – ein pro Event frei
  wählbarer Absender würde SPF/DMARC verletzen und im Spam landen.
* Jede Mail steht im `MailLog` (auch gescheiterte), jede Änderung an einer Buchung im `AuditLog` (geschrieben ab
  Phase 3, angezeigt ab Phase 4).

`.ics`-Details:

* `UID: booking-<id>@<host>` – stabil über alle Änderungen, `SEQUENCE` aus `Booking.icsSequence`. Die Sequenz steigt
  bei Änderungen, die im Kalendereintrag stehen (Personenzahl, Tisch), und beim Storno – nicht bei Name, Telefon oder
  Anmerkung.
* Eigener kleiner Generator (`app/lib/ics.ts`) statt einer Bibliothek; geprüft mit Unit-Tests und dem Python-Parser
  `icalendar`.
* `METHOD:PUBLISH` (kein `REQUEST` – sonst behandeln Clients es als Einladung mit Antwort an den Organisator);
  Storno mit `METHOD:CANCEL` und `STATUS:CANCELLED`.
* `DESCRIPTION` mit Tisch/Plätzen, Personenzahl und Verwaltungslink, zusätzlich `URL:`.
* Zeiten in UTC (`...Z`) oder mit `TZID=Europe/Berlin` + `VTIMEZONE`. CRLF-Zeilenenden, Zeilen nach 75 Oktetten falten,
  `,;\` und Zeilenumbrüche escapen. Content-Type `text/calendar; charset=utf-8; method=PUBLISH`.
* Kalender-Updates werden nicht von jedem Client zuverlässig übernommen (v. a. Google bei Anhängen). Maßgeblich ist
  immer die Verwaltungsseite – das steht auch so in der Mail.

---

## 8. Admin-Bereich

**Events:** anlegen/bearbeiten, Slug, Modus, Zugang, Status, Buchungszeitraum, `pendingTtlMinutes`, `minFillRatio`,
`maxSeatsPerBooking`, `selfEditHoursBefore`, `oneBookingPerEmail`, Pflichtfelder, Texte (Beschreibung, Hinweise in Mails), RSVP-Verknüpfung.

**Slugs:** Kleinbuchstaben, Ziffern, Bindestrich. Reservierte Namen ablehnen (`admin`, `api`, `login`, `logout`,
`account`, `b`, `verify`, `plans`, `_next`, `.well-known`, `impressum`, `datenschutz`, `forgot-password`,
`reset-password`, …; vollständige Liste in `app/lib/slugs.ts`, ein Unit-Test prüft, dass jede Route dort steht).
Pfade des Tools sind englisch, nur `/impressum` und `/datenschutz` bleiben deutsch. Achtung: `/admin` passt auch auf `/:slug` – Routing und
Header-Regeln entsprechend ordnen (siehe Stolpersteine im suite-kit-README).

**Übersicht je Event:** Plan mit Belegung (Klick auf Tisch → Buchung), Liste mit Suche/Filter nach Status, Zähler
(Tische/Plätze frei, belegt, unbestätigt), CSV-Export, Druckansicht (Tischliste für Einlass und Deko, Tischkarten).

**Buchungsaktionen:** verschieben (Tisch/Plätze wählen oder ziehen), Personenzahl ändern, Kontakt ändern, stornieren,
endgültig löschen, Verifizierung erneut senden, manuell bestätigen, interne Notiz, Verwaltungslink neu erzeugen,
Buchung manuell anlegen (z. B. telefonische Reservierung, `source = ADMIN`).

**E-Mail-Adresse korrigieren** (Entscheidung 13 Nr. 3): nur solange die Buchung `PENDING` (unbestätigt) ist – typischer
Fall: Tippfehler, die Verifizierungsmail kam nie an, die Person meldet sich telefonisch.

* Neuer Token/Code an die **neue** Adresse, der alte wird ungültig, Versuchszähler auf 0. Ob die Frist neu beginnt,
  wählt der Admin (wie beim erneuten Senden, standardmäßig an – die Person hatte ja keine Chance zu bestätigen).
* **Keine Mail an die alte Adresse:** Bei einem Tippfehler gehört sie vermutlich jemand anderem, der von der Buchung
  nichts erfahren soll.
* `oneBookingPerEmail` wird für die neue Adresse geprüft; Eintrag im Audit-Log (alt → neu).
* Bestätigte Adressen sind nicht änderbar – die Bestätigung wäre sonst wertlos. Wer eine andere Adresse braucht: Buchung
  stornieren und neu anlegen (bzw. neu buchen). Buchungen mit `source = RSVP` übernehmen die Adresse aus rsvp-app und
  sind hier nie änderbar.

**Zuordnungsmodus (`ASSIGNED`):** Gästeliste links (manuell, CSV oder aus rsvp-app), Plan rechts, Personen per
Drag & Drop auf Plätze. Markierung: noch nicht platziert, Begleitungen zusammenhalten.

**Audit-Log:** wer hat wann was an einer Buchung geändert – hilft bei Rückfragen ("ich hatte doch Tisch 4").

---

## 9. Anbindung an rsvp-app

Getrennt von der Konto-Föderation, analog zum bestehenden Vertrag zwischen rsvp-app und Abstimmungstool
(`RSVP_VERIFICATION_SECRET`). Signaturverfahren und Token-Format **von dort übernehmen**, nicht neu erfinden. Pro Event
optional (`Event.rsvpLink`: rsvp-Event-ID, Basis-URL).

**A) Zugang über Zusage (Winterball, optional Tischbuchung)**

1. In der Gästeansicht / Bestätigungsmail der rsvp-app erscheint "Sitzplatz wählen".
2. rsvp-app erzeugt ein signiertes, kurz gültiges Token: `aud` (Seating-BASE_URL), rsvp-Event, Gast-ID, Name, E-Mail,
   Personenzahl (1 + Begleitungen), ggf. Namen der Begleitungen, `exp`.
3. Seating prüft Signatur, `aud`, `exp` und die Event-Verknüpfung, legt die Buchung `source = RSVP` mit
   `externalRef = rsvp:<event>:<gast>` an bzw. öffnet die bestehende. Keine Mail-Verifizierung, Personenzahl fest
   vorgegeben (nicht änderbar durch Kund*in).
4. Seating meldet die Platzierung zurück (analog zur Ergebnis-Meldung des Abstimmungstools), damit rsvp-app sie in der
   Gästeansicht und **beim Einlass** anzeigen kann ("Tisch 7, Plätze 3–4").
5. Sagt der Gast in rsvp-app ab oder ändert die Begleitungen, muss Seating davon erfahren (Rückmeldung von rsvp-app oder
   Abgleich, siehe offene Entscheidungen) und die Plätze freigeben bzw. die Buchung markieren.

**B) Gästeliste übernehmen (Hochzeit)**

* Seating ruft serverseitig die bestätigten Zusagen samt Begleitungen des verknüpften rsvp-Events ab (signierte Anfrage).
* Admin ordnet zu. Button "Abgleichen" zeigt neue, abgesagte und geänderte Gäste; nichts wird still gelöscht.
* Optional: rsvp-app zeigt Gästen "Dein Platz" an (Rückmeldung wie in A.4).

**Nötige Änderungen in rsvp-app** (eigenes Repo, eigene Aufgabe): Button/Link mit Token, Endpunkt für Gästeliste,
Empfang der Platzierung, Anzeige beim Einlass, Benachrichtigung bei Absage/Änderung.

---

## 10. Konten und Suite

* Konten gibt es nur für Veranstalter*innen/Admins. Buchende haben kein Konto.
* **Rollen wie im Abstimmungstool** (entschieden, siehe Abschnitt 13 Nr. 9): `ADMIN` (alles), `CREATOR` (eigene Events
  und Raumpläne, Moderator*innen einladen), `MODERATOR` (nur freigegebene Events). Die Freigabe pro Event
  (`EventAccess`, analog `PollAccess`) gibt es seit Phase 2: Besitzer*in oder Admin gibt einem bestehenden Konto frei,
  freigegebene Konten dürfen alles außer löschen und weiter freigeben (`eventLevel` in `app/lib/permissions.ts`).
  Die Kontoverwaltung (`/admin/users`) gibt es seit Phase 0.
* Föderation nach `suite-kit` (Endpunkte, Env wie im suite-kit-README). Für Seating sinnvoll: andere Tools als
  `SUITE_IDPS` mit `autoProvision: false`, `mapAdminRole` aus.
* Ob mehrere Admins pro Event mit unterschiedlichen Rechten nötig sind, siehe offene Entscheidungen.

---

## 11. Betrieb und Datenschutz

Zusätzliche Env-Variablen (neben denen der Suite): `DATABASE_URL`, `SMTP_*`, `MAIL_FROM`, `CRON_SECRET`,
`MANAGE_LINK_SECRET`, `MANAGE_LINK_SECRET_PREVIOUS`, `VERIFY_CODE_SECRET`, ggf. `RSVP_*` für den Vertrag mit rsvp-app,
optional `TURNSTILE_*`.

* Löschfristen suite-weit: Inhalte 18 Monate nach Eventende (Events seit Phase 2 im Cron), Konten nach 2 Jahren ohne Anmeldung (Admins ausgenommen).
  Abgelaufene/stornierte Buchungen deutlich früher entfernen (Vorschlag: 30 Tage).
* Datensparsamkeit: Telefon nur, wenn pro Event verlangt. Datenschutzhinweis auf der Buchungsseite. Kein Tracking.
* Öffentliche Plan-Ansicht zeigt nur "belegt", **nie Namen** – außer der Admin aktiviert es ausdrücklich
  (z. B. Tischkarten-Ansicht auf einer Hochzeit).

---

## 12. Phasen

| Phase | Inhalt |
| --- | --- |
| 0 | Gerüst nach Vorbild Abstimmungstool: Next.js, DB, Docker, Admin-Login, Sicherheits-Header, `suite-kit` als Abhängigkeit, README |
| 1 | Raumplan: Datenformat, Editor (Tische, Plätze, statische Objekte, Reihen-Generator), Vorlagen, Import/Export |
| 2 | Events: Anlegen mit Plan-Snapshot, Slug-Routing, öffentliche Planansicht mit Belegung (noch ohne Buchung), Freigaben – in der Oberfläche nur Modus `TABLE` + Zugang `OPEN` |
| 3 | Tischbuchung `TABLE`+`OPEN`: Reservierung, Verifizierung, Verfall, Bestätigung, `.ics`, Verwaltungslink (umgesetzt, Buchungsliste für Veranstalter*innen nur zum Lesen) |
| 4 | Admin-Buchungsverwaltung: Verschieben, Ändern, Löschen, Änderungsmails, Rundmail, erneute Verifizierung, Audit, Export |
| 4b | Warteliste mit Nachrück-Angebot (Abschnitt 5) |
| 5 | Modus `SEAT` (Kino/Winterball) |
| 6 | Modus `ASSIGNED` (Hochzeit) mit manueller/CSV-Gästeliste |
| 7 | rsvp-app-Anbindung (A und B), Änderungen in rsvp-app |
| 8 | Konto-Föderation über `suite-kit`, Eintrag im suite-kit-README |

Jede Phase endet mit Tests (Unit mit vitest in `tests/unit`, Playwright in `tests/e2e` gegen eine frisch gebaute
Instanz mit eigener Test-Datenbank), README-Update, Commit. Die anderen Tools der Suite haben (Stand Phase 0) kein
Test-Setup im Repo; Seating ist das erste mit automatisierten Tests.

---

## 13. Offene Entscheidungen

1. ~~**Pro E-Mail nur eine Buchung je Event?**~~ **Entschieden:** ja als Voreinstellung, pro Event abschaltbar
   (`oneBookingPerEmail`), siehe Abschnitt 4.
2. ~~**Verlängert "Verifizierung erneut senden" den Verfall?**~~ **Entschieden:** bei Kund*in nein, beim Admin wählbar,
   siehe Abschnitt 5.
3. ~~**Darf der Admin die E-Mail-Adresse ändern?**~~ **Entschieden:** nur bei unbestätigten Buchungen (Korrektur mit
   neuer Verifizierung, keine Mail an die alte Adresse); bestätigte Adressen nie. Siehe Abschnitt 8.
4. ~~**Tische teilen:** Darf in `TABLE` ein großer Tisch an mehrere kleine Gruppen gehen?~~ **Entschieden: nein.** Das
   Gefühl "unser Tisch" geht vor – im Modus `TABLE` gehört ein Tisch immer genau einer Buchung. Wer Plätze einzeln
   vergeben will, nutzt `SEAT`.
5. ~~**Bis wann dürfen Kund*innen selbst ändern/stornieren?**~~ **Entschieden:** Standard Eventbeginn − 24 h, pro
   Event anpassbar (`selfEditHoursBefore`), siehe Abschnitt 4.
6. **Begleitpersonen in rsvp-app:** nur Anzahl oder mit Namen? Bestimmt, ob Seating Namen pro Platz kennt.
7. **Synchronisation mit rsvp-app bei Absage:** Push von rsvp-app an Seating oder Abgleich durch Seating?
8. ~~**Warteliste** für ausgebuchte Events (rsvp-app hat eine) – jetzt, später oder gar nicht?~~ **Entschieden:** ja, als
   eigener Schritt nach Phase 4, mit zeitlich begrenztem Nachrück-Angebot statt automatischer Zuteilung (Abschnitt 5).
9. ~~**Rollen:** reicht "Admin sieht alles", oder braucht es Event-bezogene Admins (z. B. Brautpaar sieht nur die eigene
   Hochzeit)?~~ **Entschieden:** Rollen wie im Abstimmungstool (`ADMIN`/`CREATOR`/`MODERATOR`) plus Freigabe pro Event
   (`EventAccess`) ab Phase 2 – das Brautpaar ist `MODERATOR` mit Freigabe für die eigene Hochzeit. Siehe Abschnitt 10.
