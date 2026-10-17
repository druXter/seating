# Oberfläche – Konzept

Neugestaltung vom 2026-10-17, angelehnt an rsvp-app, Abstimmungstool, Schichten und Zeitplan (dort jeweils
`docs/KONZEPT-OBERFLAECHE.md`). Ziel: Wer mehrere Tools der Suite nutzt, findet sich sofort zurecht – gleiche Kopfzeile,
gleiche Bausteine, gleicher Aufbau „Übersicht → Seite mit Reitern → Einstellungen in Abschnitten“. Schwerpunkt Handy:
Buchende buchen fast nur am Telefon, Veranstalter\*innen schauen am Tag selbst mit dem Telefon nach Buchungen und Plätzen.

## Ausgangslage

* „Verwaltung“ war eine Linkliste, „Events“ eine Textliste mit Titel, Zeitraum und Adresse – ohne Belegung.
* Die Event-Seite war eine lange Spalte: Link, Plan mit Belegung, eine Linkreihe mit fünf gleichrangigen Wegen, darunter
  ein Einstellungsformular mit über 20 Feldern (Status, Titel, Modus, rsvp-app, Zeiten, Buchung, Warteliste, Mails) und
  daneben Hintergrundbild, Freigaben und Löschen. Unterseiten hatten je einen eigenen Pfad zurück („Event › Buchungen“).
* Kopfzeile nur als Textlinks rechts oben (fünf Einträge plus Abmelden), auf dem Handy umbrechend.
* Auf dem Handy: Buchungsliste als sechsspaltige Tabelle mit seitlichem Scrollen, Eingabefelder in 14 px (iOS zoomt
  hinein), Zoom-Knöpfe im Plan sehr klein; in Sitzordnung und „Im Plan verschieben“ lag das Auswahlfeld über dem Plan,
  also unter der langen Gästeliste.

## Aufbau

| Seite | Inhalt |
| --- | --- |
| `/admin`, `/admin/events` | Übersicht „Events“: *Aktuell* (nicht archiviert und noch nicht vorbei) und eingeklappt *Vergangen*. Pro Event Tag, Status, Art der Buchung, „mit rsvp-app“, „freigegeben“, Zeitraum, Ort und – bei aktuellen – die Belegung mit Balken (belegte Tische bzw. Plätze, Buchungen mit Personen, Warteliste; bei einer Sitzordnung Personen mit Platz). Oben „Neues Event“. |
| `/admin/events/[id]` | Event-Seite mit Kopf (Titel, Zeitraum, Ort, Status, Art, Merkmale, „Öffentliche Seite ↗“ bzw. „Vorschau ↗“) und Reitern. **Übersicht**: Kennzahlen, Status mit Knöpfen (Veröffentlichen, Buchung schließen, Archivieren …), „Für Gäste“ (Link, Zugang), Plan mit Belegung (Klick führt zur Buchung bzw. zum Anlegen), „Buchung anlegen“ bzw. „Gäste setzen“, Druckansicht, Tisch- bzw. Platzkarten. |
| `…/bookings` | **Buchungen** bzw. **Gäste**: Zähler, Wege (Anlegen, CSV-Export, Druck), Abgleich mit rsvp-app einklappbar, Suche und Filter, Liste als Zeilen (auf dem Handy untereinander, E-Mail und Telefon antippbar), Verlauf einklappbar. Buchung anlegen und eine Buchung bzw. Gruppe gehören zum Reiter. |
| `…/arrange` | **Im Plan verschieben** bzw. **Sitzordnung** (Gäste hinzufügen und rsvp-Abgleich einklappbar). Auf dem Handy hängt das Auswahlfeld, solange etwas gewählt ist, unten am Bildschirm. |
| `…/mail` | **Rundmail** (nicht bei einer Sitzordnung). |
| `…/plan` | **Raumplan**: Editor, darunter einklappbar *Vorlage* („Plan aus Vorlage neu übernehmen“) und *Hintergrundbild*. |
| `…/settings` | **Einstellungen** in Abschnitten mit Kurzstand: Event · Buchung · Warteliste · Mails an Buchende · Zugang und rsvp-app; für Besitzer\*in und Admins dazu Freigaben und Löschen. `?section=<id>` öffnet einen Abschnitt. |
| `…/print` | Druckansicht im selben Rahmen, Umschalter Liste/Karten; Kopf und Reiter erscheinen nicht im Ausdruck. |
| `/admin/plans`, `/admin/plans/[id]` | Raumpläne als Karten mit Größe, Tischen, Plätzen und Knöpfen; ein Plan mit Kopf (Duplizieren, Exportieren), Editor und einklappbar „Name und Freigabe“ und „Hintergrundbild“. |

**Abweichung von Zeitplan:** Die Abschnitte der Einstellungen bilden *ein* Formular mit einer Speichern-Leiste, die beim
Scrollen unten sichtbar bleibt. Die Felder werden zusammen geprüft (`parseEventForm`: Buchungszeitraum gegen Beginn,
Zugang gegen rsvp-Verknüpfung, Moduswechsel gegen Buchungen); zugeklappte Abschnitte bleiben im DOM und werden
mitgeschickt. Den Status ändern eigene Knöpfe (`setEventStatus`), nicht mehr das Formular. Freigegebene Konten sehen den
Reiter Einstellungen wie bisher (sie dürfen alles außer löschen und freigeben).

## Gestaltung

* Bausteine in `app/ui/kit.tsx`, dieselben wie in den anderen Tools (Card, Badge, Stat, ProgressBar,
  ButtonLink/buttonClass, SettingsSection, PageHeader, Main, EmptyState, Segmented, inputClass). Hinweise über
  `app/ui/notice.tsx` mit denselben Farben; `status-badge.tsx` und `booking-status-badge.tsx` nutzen den Badge aus dem Kit.
* Ruhig: weiß/grau, Blau nur für Hauptaktionen und den aktiven Reiter, keine Emojis an Knöpfen. Farbe trägt Bedeutung:
  Event grün veröffentlicht, amber geschlossen, grau Entwurf/archiviert; Buchung grün bestätigt, amber unbestätigt bzw.
  Angebot, blau Warteliste, grau storniert/verfallen; türkis freigegeben, pink rsvp-app, lila interne Notiz.
* Kopfzeile (`app/ui/account-nav.tsx`): Marke, Events, bei Creator und Admins Raumpläne und Konten, Konto-Menü (Mein
  Konto, Abmelden; schließt sich nach Seitenwechsel und Klick daneben). Auf Seiten für Buchende (`/<slug>`, `/b/…`,
  `/verify/…`, `/rsvp/…`) nur für angemeldete Konten (`app/ui/header-gate.tsx`). Beim Drucken ausgeblendet. Eingebettet
  öffnen Impressum und Datenschutz in einem neuen Tab (`app/ui/footer-link.tsx`).
* Handy: Reiter seitlich scrollbar (der aktive scrollt ins Bild), Eingabefelder in 16 px, Plan-Knöpfe 40 px hoch,
  Aktionen unter dem Inhalt statt daneben, Kennzahlen zweispaltig.
* Einklappbare Abschnitte merken sich ihren Zustand selbst (`app/ui/disclosure.tsx`).
* Der Raumplan selbst bleibt unverändert hell (Belegung und Schraffuren eindeutig).

## Seiten für Buchende

Aufbau unverändert (Kopf als Karte, Hinweis zur Buchung, Plan mit Liste), nur in den Bausteinen der Suite: 16-px-Felder,
größere Zoom-Knöpfe, das Buchungsformular nach der Wahl hervorgehoben. Bei Einzelplätzen führt auf dem Handy eine Leiste
am unteren Rand („N Plätze gewählt – weiter zu deinen Angaben“) zum Formular unter Plan und Platzliste, solange es nicht
im Bild ist.
