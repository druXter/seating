// app/datenschutz/page.tsx
import Link from 'next/link'

// ENTWURF: Beschreibt, was dieses Tool tatsächlich speichert und verarbeitet. Er ersetzt keine
// Rechtsberatung - vor dem Einsatz mit Externen bitte einmal prüfen lassen und bei jeder
// Änderung der Datenverarbeitung mitpflegen. Stand: Phase 4 (Konten der Veranstalter*innen,
// Raumpläne mit Hintergrundbildern, Events mit öffentlicher Planansicht und Freigaben, Tischbuchung
// ohne Konto mit Mail-Bestätigung, Verwaltungslink, Buchungsmails mit .ics und Löschfristen;
// Buchungsverwaltung durch Veranstalter*innen mit interner Notiz, Rundmail und CSV-Export;
// Warteliste mit Nachrück-Angebot, Phase 4b).
//
// Liest Verantwortlichen- und Infrastruktur-Angaben zur Laufzeit aus der (nicht
// versionierten) .env, analog zu app/impressum/page.tsx - force-dynamic verhindert, dass
// Next die Platzhalter beim Docker-Build dauerhaft in die statische HTML einbrennt.
export const dynamic = 'force-dynamic'

export default function DatenschutzPage() {
  const name = process.env.IMPRESSUM_NAME || '[Dein Vorname] [Dein Nachname]'
  const street = process.env.IMPRESSUM_STREET || '[Deine Straße und Hausnummer]'
  const zip = process.env.IMPRESSUM_ZIP || '[PLZ]'
  const city = process.env.IMPRESSUM_CITY || '[Ort]'
  const email = process.env.IMPRESSUM_EMAIL || '[Deine E-Mail-Adresse]'
  const phone = process.env.IMPRESSUM_PHONE || '[Deine Telefonnummer - Optional]'
  const smtpHost = process.env.SMTP_HOST || '[E-Mail-Server noch nicht konfiguriert]'

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow text-gray-800 space-y-6">
        <h1 className="text-3xl font-bold border-b pb-4">Datenschutzerklärung</h1>

        <div>
          <h2 className="font-bold text-lg">1. Verantwortlicher</h2>
          <p className="mt-2">
            Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) für die Datenverarbeitung auf dieser
            Website ist:
          </p>
          <p className="mt-2">
            {name}<br />
            {street}<br />
            {zip} {city}<br />
            E-Mail: {email}<br />
            Telefon: {phone}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Weitere Angaben findest du im <Link href="/impressum" className="underline">Impressum</Link>.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">2. Worum es geht</h2>
          <p className="mt-2">
            Mit dieser Anwendung verwalten Veranstalter*innen Raumpläne und Sitzplätze für Veranstaltungen. Ein Konto
            brauchen nur Personen, die Veranstaltungen anlegen oder verwalten. Wir verarbeiten nur, was dafür nötig ist
            (Art. 6 Abs. 1 lit. b und f DSGVO - Bereitstellung der Funktionen bzw. Betrieb und Sicherheit der
            Anwendung). Es gibt kein Tracking und keine Analyse-Werkzeuge.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">3. Konto (für Veranstalter*innen)</h2>
          <p className="mt-2">Für ein Konto speichern wir:</p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>E-Mail-Adresse, optional einen Namen, deine Rolle, den Zeitpunkt der Anlage und der letzten Anmeldung,</li>
            <li>dein Passwort ausschließlich als <strong>Hash</strong> (scrypt) - niemals im Klartext,</li>
            <li>
              deine Anmelde-Sitzungen (nur ein Hash des Sitzungs-Tokens und das Ablaufdatum, 30 Tage) sowie
              Einmal-Links für Einladung und Passwort-Reset (ebenfalls nur als Hash, befristet).
            </li>
          </ul>
          <p className="mt-2">
            Konten werden nicht öffentlich registriert, sondern von einer berechtigten Person eingeladen.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">4. Raumpläne, Veranstaltungen und hochgeladene Bilder</h2>
          <p className="mt-2">
            Veranstalter*innen können Raumpläne anlegen und optional ein Bild (z.B. einen Grundriss) als Hintergrund
            hochladen. Gespeichert werden der Plan, sein Name, das Konto, dem er gehört, und das Bild als Datei auf unserem
            Server. Sehen können Plan und Bild nur das besitzende Konto und Administrator*innen sowie – wenn der Plan
            ausdrücklich als gemeinsame Vorlage angeboten wird – andere angemeldete Veranstalter*innen. Öffentlich
            abrufbar ist beides nicht.
          </p>
          <p className="mt-2">
            Raumpläne sollen keine personenbezogenen Daten enthalten; bitte lade keine Bilder hoch, auf denen Personen oder
            Namen zu sehen sind. Ein Plan bleibt gespeichert, bis er gelöscht wird; mit dem Löschen verschwindet auch das
            Bild. Wird ein Konto gelöscht, gehen seine Raumpläne an eine*n Administrator*in über.
          </p>
          <p className="mt-2">
            Für eine Veranstaltung speichern wir Titel, Adresse der Veranstaltungsseite, Beschreibung, Ort, Zeiten und
            Einstellungen, eine Kopie des Raumplans (mit Bild), das Konto, dem sie gehört, und die Konten, für die sie
            freigegeben wurde. Veröffentlichte Veranstaltungsseiten sind für alle abrufbar, die den Link kennen (auch
            eingebettet auf anderen Webseiten), werden aber nicht für Suchmaschinen freigegeben. Sie zeigen im Plan und
            in der Tischliste nur, ob ein Tisch <strong>frei oder belegt</strong> ist – nie, wer ihn gebucht hat.
            Die Angabe „Wie viele Personen seid ihr?“ zum Hervorheben passender Tische wird nur in deinem Browser
            ausgewertet und nicht an uns übertragen. Wird ein Konto gelöscht, gehen seine Veranstaltungen an eine*n
            Administrator*in über.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">5. Buchen eines Tisches (ohne Konto)</h2>
          <p className="mt-2">
            Wenn du einen Tisch buchst, speichern wir deinen <strong>Namen</strong>, deine{' '}
            <strong>E-Mail-Adresse</strong>, die <strong>Personenzahl</strong>, den gewählten Tisch, eine optionale
            Anmerkung und – nur wenn du sie angibst oder die Veranstaltung sie verlangt – deine{' '}
            <strong>Telefonnummer</strong>, dazu die Zeitpunkte von Buchung, Bestätigung, Änderungen und Stornierung.
            Rechtsgrundlage ist die Durchführung der Buchung (Art. 6 Abs. 1 lit. b DSGVO).
          </p>
          <p className="mt-2">
            Die Buchung gilt erst, wenn du deine E-Mail-Adresse per Link oder 6-stelligem Code bestätigst. Link und Code
            speichern wir nur als Hash bzw. mit einem geheimen Schlüssel verrechnet und löschen sie mit der Bestätigung.
            Bis dahin ist der Tisch kurz für dich reserviert (voreingestellt 30 Minuten); ohne Bestätigung verfällt die
            Reservierung. Solange sie unbestätigt ist, speichern wir außerdem einen Hash deiner IP-Adresse, um die Zahl
            gleichzeitiger Reservierungen zu begrenzen – er wird mit der Bestätigung oder dem Verfall gelöscht.
          </p>
          <p className="mt-2">
            Deine Angaben sehen nur die Veranstalter*innen dieser Veranstaltung (die Konten, die sie verwalten). Auf der
            öffentlichen Seite erscheint dein Tisch nur als „belegt“ – ohne Namen. Mit dem persönlichen Link aus der
            Bestätigungsmail kannst du deine Buchung ansehen, ändern und stornieren; wer diesen Link hat, kann das
            ebenfalls – gib ihn deshalb nicht weiter. Welche Mails wir dir geschickt haben und welche Änderungen es an
            der Buchung gab, protokollieren wir (Art, Zeitpunkt, Empfängeradresse, Zustellstatus bzw. alte und neue
            Werte), um Rückfragen beantworten zu können.
          </p>
          <p className="mt-2">
            Die Veranstalter*innen können deine Buchung ändern (z. B. einen anderen Tisch zuweisen), stornieren oder
            löschen – darüber informieren sie dich in der Regel per Mail mit einer Gegenüberstellung alt/neu. Sie können
            zu einer Buchung eine <strong>interne Notiz</strong> hinterlegen (z. B. „Rollstuhlplatz“), die du nicht
            siehst, und die Buchungen für die Durchführung der Veranstaltung als Liste ausdrucken oder als CSV-Datei
            exportieren (z. B. Tischliste für den Einlass). Für den Export sind die Veranstalter*innen selbst
            verantwortlich; wir empfehlen, ihn nach der Veranstaltung zu löschen.
          </p>
          <p className="mt-2">
            Reservierst du telefonisch oder auf anderem Weg, können die Veranstalter*innen die Buchung auch selbst
            anlegen – dann mit den Angaben, die du ihnen gibst; eine E-Mail-Adresse ist dafür nicht nötig (ohne Adresse
            bekommst du keine Mails und keinen persönlichen Link).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">5a. Warteliste</h2>
          <p className="mt-2">
            Ist für deine Gruppe gerade kein passender Tisch frei, kannst du dich auf die Warteliste setzen. Wir speichern
            dieselben Angaben wie bei einer Buchung (ohne Tisch) und den Zeitpunkt deines Eintrags, der die Reihenfolge
            bestimmt. Der Eintrag gilt erst, wenn du deine E-Mail-Adresse per Link oder Code bestätigst; unbestätigte Einträge
            verfallen nach 24 Stunden.
          </p>
          <p className="mt-2">
            Wird ein passender Tisch frei, reservieren wir ihn für eine begrenzte Zeit für dich und schicken dir ein Angebot
            per Mail. Nimmst du es an, wird daraus eine Buchung (siehe Punkt 5). Lehnst du ab, reagierst du nicht rechtzeitig
            oder trägst du dich aus, endet der Eintrag. Die Veranstalter*innen sehen die Warteliste und können dir auch direkt
            einen Tisch zuweisen. Rechtsgrundlage ist wie bei der Buchung Art. 6 Abs. 1 lit. b DSGVO; zur Speicherdauer siehe
            Punkt 10 (beendete Einträge wie stornierte Buchungen).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">6. Schutz vor Missbrauch (Drosselung)</h2>
          <p className="mt-2">
            Um das Erraten von Passwörtern und das massenhafte Auslösen von Mails zu verhindern, zählen wir
            fehlgeschlagene Anmeldeversuche, Passwort-Reset-Anfragen, Reservierungen, Code-Eingaben und angeforderte
            Bestätigungsmails. Dazu wird deine{' '}
            <strong>IP-Adresse</strong> ausgelesen und zusammen mit der eingegebenen E-Mail-Adresse{' '}
            <strong>nur als nicht umkehrbarer Hash</strong> für ein kurzes Zeitfenster (15 Minuten bzw. 1 Stunde)
            gespeichert; veraltete Zähler werden nach spätestens 24 Stunden entfernt. Rechtsgrundlage ist unser
            berechtigtes Interesse an der Sicherheit der Anwendung (Art. 6 Abs. 1 lit. f DSGVO).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">7. E-Mails</h2>
          <p className="mt-2">
            Wir verschicken E-Mails nur für Kontofunktionen (Einladung zu einem neuen Konto, auf Wunsch angeforderter
            Passwort-Reset) und für deine Buchung: die Bitte um Bestätigung (mit Link und Code), die Bestätigung mit
            Kalenderdatei und persönlichem Link, Änderungen und Stornierungen (durch dich oder die Veranstalter*innen),
            einen neuen persönlichen Link, falls der alte ersetzt wurde, einen Hinweis, falls mit deiner Adresse erneut
            gebucht werden sollte, für die Warteliste die Bitte um Bestätigung, die Bestätigung deines Eintrags, ein Angebot
            für einen frei gewordenen Tisch und ggf. den Hinweis, dass das Angebot verfallen ist, sowie <strong>Rundmails der Veranstalter*innen</strong> zur Veranstaltung, für die
            du gebucht hast (z. B. geänderte Einlasszeiten). Antworten auf Buchungsmails gehen an die Veranstalter*innen, sofern sie
            eine Antwortadresse hinterlegt haben. Werbung oder Newsletter gibt es nicht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">8. Cookies</h2>
          <p className="mt-2">
            Wir setzen ausschließlich technisch notwendige Cookies ein (Art. 6 Abs. 1 lit. b/f DSGVO, § 25 Abs. 2 Nr. 2
            TDDDG) - eine Einwilligung ist dafür nicht erforderlich. Es gibt keine Tracking-, Analyse- oder
            Marketing-Cookies.
          </p>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li><code>__Host-session</code> - Anmeldung an deinem Konto (30 Tage)</li>
            <li><code>invite_link</code> - nur kurz (2 Minuten), wenn ein Konto einen Einladungslink zum Weitergeben angezeigt bekommt</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-lg">9. Empfänger und Auftragsverarbeiter</h2>
          <p className="mt-2">
            <strong>E-Mail-Versand:</strong> Einladungs-, Passwort-Reset- und Buchungsmails versenden wir über den
            E-Mail-Server <code>{smtpHost}</code>. Mit dem Betreiber dieses Servers besteht, soweit es sich um einen
            externen Anbieter handelt, ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.
          </p>
          <p className="mt-2">
            <strong>Hosting:</strong> Diese Anwendung wird auf einem vom Verantwortlichen selbst betriebenen und
            administrierten Server gehostet. Es findet keine Weitergabe der Daten an einen externen Hosting-Anbieter
            statt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">10. Speicherdauer</h2>
          <p className="mt-2">
            Ein Konto wird automatisch gelöscht, wenn du dich <strong>2 Jahre</strong> lang nicht mehr angemeldet
            hast und dir keine Raumpläne und Veranstaltungen mehr gehören - inklusive Sitzungen und Freigaben.
            Administrator-Konten sind von dieser
            automatischen Löschung ausgenommen.
            Unabhängig davon kannst du jederzeit unter der oben genannten Adresse um frühere Löschung deines Kontos
            bitten.
          </p>
          <p className="mt-2">
            Sitzungen laufen nach 30 Tagen ab, Einladungs- und Reset-Links nach 7 Tagen bzw. 1 Stunde und werden dann
            entfernt. Drossel-Zähler siehe Punkt 6.
          </p>
          <p className="mt-2">
            Veranstaltungen werden <strong>18 Monate nach ihrem Ende</strong> automatisch gelöscht, samt Raumplan, Bild,
            Freigaben und allen zugehörigen Buchungen.
          </p>
          <p className="mt-2">
            Verfallene und stornierte Buchungen sowie beendete Einträge der Warteliste löschen wir <strong>30 Tage</strong> nach ihrer letzten Änderung, samt
            Mail- und Änderungsprotokoll. Bestätigte Buchungen bleiben bis zur Löschung der Veranstaltung gespeichert
            (siehe oben) – oder bis die Veranstalter*innen sie früher löschen.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">11. Deine Rechte</h2>
          <p className="mt-2">
            Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung (Art. 17 DSGVO),
            Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit (Art. 20 DSGVO) und Widerspruch (Art.
            21 DSGVO). Bitte kontaktiere uns dafür über die oben genannte Adresse. Dein Passwort kannst du jederzeit
            unter &quot;Mein Konto&quot; selbst ändern.
          </p>
          <p className="mt-2">
            Unabhängig davon hast du das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn du der
            Ansicht bist, dass die Verarbeitung deiner Daten gegen die DSGVO verstößt.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">12. Datensicherheit</h2>
          <p className="mt-2">
            Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Anmelde-Cookies sind <code>httpOnly</code> gesetzt und
            damit per JavaScript nicht auslesbar. Passwörter, Sitzungs-Tokens und Einmal-Links werden nur als Hash
            gespeichert, sodass eine Kopie der Datenbank allein keinen Zugang zu Konten ermöglicht.
          </p>
        </div>

        <div className="pt-6 border-t">
          <Link href="/" className="text-blue-600 hover:underline">
            &larr; Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}
