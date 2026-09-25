// app/datenschutz/page.tsx
import Link from 'next/link'

// ENTWURF: Beschreibt, was dieses Tool tatsächlich speichert und verarbeitet. Er ersetzt keine
// Rechtsberatung - vor dem Einsatz mit Externen bitte einmal prüfen lassen und bei jeder
// Änderung der Datenverarbeitung mitpflegen. Stand: Phase 0 (nur Konten der
// Veranstalter*innen). Mit Phase 3 kommen Buchungen dazu (Name, E-Mail, ggf. Telefon,
// Gruppengröße, Verifizierung, Buchungsmails mit .ics, Verwaltungslink, Löschfristen für
// Buchungen) - dann hier ergänzen, siehe docs/KONZEPT.md Abschnitt 11.
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
          <h2 className="font-bold text-lg">4. Schutz vor Missbrauch (Drosselung)</h2>
          <p className="mt-2">
            Um das Erraten von Passwörtern und das massenhafte Auslösen von Mails zu verhindern, zählen wir
            fehlgeschlagene Anmeldeversuche und Passwort-Reset-Anfragen. Dazu wird deine{' '}
            <strong>IP-Adresse</strong> ausgelesen und zusammen mit der eingegebenen E-Mail-Adresse{' '}
            <strong>nur als nicht umkehrbarer Hash</strong> für ein kurzes Zeitfenster (15 Minuten bzw. 1 Stunde)
            gespeichert; veraltete Zähler werden nach spätestens 24 Stunden entfernt. Rechtsgrundlage ist unser
            berechtigtes Interesse an der Sicherheit der Anwendung (Art. 6 Abs. 1 lit. f DSGVO).
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">5. E-Mails</h2>
          <p className="mt-2">
            Wir verschicken E-Mails nur für Kontofunktionen: die Einladung zu einem neuen Konto und den auf Wunsch
            angeforderten Passwort-Reset. Werbung oder Newsletter gibt es nicht.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">6. Cookies</h2>
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
          <h2 className="font-bold text-lg">7. Empfänger und Auftragsverarbeiter</h2>
          <p className="mt-2">
            <strong>E-Mail-Versand:</strong> Einladungs- und Passwort-Reset-Mails versenden wir über den
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
          <h2 className="font-bold text-lg">8. Speicherdauer</h2>
          <p className="mt-2">
            Ein Konto wird automatisch gelöscht, wenn du dich <strong>2 Jahre</strong> lang nicht mehr angemeldet
            hast - inklusive Sitzungen. Administrator-Konten sind von dieser automatischen Löschung ausgenommen.
            Unabhängig davon kannst du jederzeit unter der oben genannten Adresse um frühere Löschung deines Kontos
            bitten.
          </p>
          <p className="mt-2">
            Sitzungen laufen nach 30 Tagen ab, Einladungs- und Reset-Links nach 7 Tagen bzw. 1 Stunde und werden dann
            entfernt. Drossel-Zähler siehe Punkt 4.
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">9. Deine Rechte</h2>
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
          <h2 className="font-bold text-lg">10. Datensicherheit</h2>
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
