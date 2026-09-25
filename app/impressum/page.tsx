// app/impressum/page.tsx
import Link from 'next/link'

// Liest die echten Angaben zur Laufzeit aus der (nicht versionierten) .env - im
// Repository bleiben dadurch nur Platzhalter sichtbar. Gleiches Muster wie in
// rsvp-app und im Abstimmungstool, bewusst dieselben Umgebungsvariablen-Namen, damit
// eine gemeinsame .env (falls die Tools denselben Betreiber-Kontext teilen) für alle reicht.
export const dynamic = 'force-dynamic'

export default function ImpressumPage() {
  const name = process.env.IMPRESSUM_NAME || '[Dein Vorname] [Dein Nachname]'
  const street = process.env.IMPRESSUM_STREET || '[Deine Straße und Hausnummer]'
  const zip = process.env.IMPRESSUM_ZIP || '[PLZ]'
  const city = process.env.IMPRESSUM_CITY || '[Ort]'
  const email = process.env.IMPRESSUM_EMAIL || '[Deine E-Mail-Adresse]'
  const phone = process.env.IMPRESSUM_PHONE || '[Deine Telefonnummer - Optional]'

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow text-gray-800 space-y-6">
        <h1 className="text-3xl font-bold border-b pb-4">Impressum</h1>

        <div>
          <h2 className="font-bold text-lg">Angaben gemäß § 5 DDG</h2>
          <p className="mt-2">
            {name}<br />
            {street}<br />
            {zip} {city}
          </p>
        </div>

        <div>
          <h2 className="font-bold text-lg">Kontakt</h2>
          <p className="mt-2">
            E-Mail: {email}<br />
            Telefon: {phone}
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
