import type { NextConfig } from "next";

// Seiten, die nie in einem fremden iFrame auftauchen dürfen (Clickjacking): alles, was ein
// Konto, eine Anmeldung oder einen persönlichen Verwaltungslink betrifft.
const NO_FRAMING = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

// Seiten, die weder in Suchmaschinen noch in Caches landen sollen.
const PRIVATE_PAGE = [
  ...NO_FRAMING,
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Cache-Control", value: "no-store" },
];

// Einbettbare öffentliche Eventseiten (wie in rsvp-app, z.B. als iFrame in ein CMS). Fest im Code
// statt per Env: Die Regeln hier werden beim Build festgeschrieben, eine Env-Variable im laufenden
// Container würde nicht greifen. Wer nur bestimmte Seiten einbetten lassen will, ersetzt `*` durch
// deren Origin(s) und baut neu.
const EMBEDDABLE = [{ key: "Content-Security-Policy", value: "frame-ancestors *" }];

const nextConfig: NextConfig = {
  // REIHENFOLGE IST WICHTIG: Passen mehrere Regeln auf denselben Pfad und setzen denselben
  // Header, gewinnt die SPÄTERE (siehe node_modules/next/dist/docs/01-app/03-api-reference/
  // 05-config/01-next-config-js/headers.md, "Header Overriding Behavior"). Ein Header lässt sich
  // dabei nur überschreiben, nicht entfernen - deshalb setzt die allgemeine Regel KEINE
  // Framing-Header (X-Frame-Options: DENY kennt keinen "erlaubt"-Wert und stünde sonst auch auf
  // den Eventseiten). Aufbau:
  //
  //   1. allgemeine Regel für alles (ohne Framing)
  //   2. kein Einbetten für "/" und alle mehrteiligen Pfade (/admin/..., /b/..., /api/...)
  //   3. einbettbar: alle einteiligen Pfade /:slug - die öffentlichen Eventseiten.
  //      ACHTUNG: /:slug passt auch auf /admin, /login, /account ...
  //   4. danach die einteiligen Seiten des Tools, die das Einbetten wieder verbieten - sie stehen
  //      bewusst HINTER Regel 3, damit sie deren Freigabe überschreiben - und die sensiblen
  //      Bereiche mit weiteren Headern.
  //   5. Föderations-Endpunkte (Referrer-Policy)
  //
  // Nicht gesetzt: eine vollständige Content-Security-Policy. Sie würde für Next.js Nonces
  // pro Anfrage brauchen (siehe node_modules/next/dist/docs/01-app/02-guides/
  // content-security-policy.md) und alle Seiten dynamisch machen - der Nutzen ist gering,
  // da nirgends fremder Inhalt als HTML ausgegeben wird (React maskiert alles).
  async headers() {
    return [
      {
        // 1. Allgemein.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Nur für diesen Host (ohne includeSubDomains), damit andere Subdomains der
          // Suite davon unberührt bleiben. Wirkt nur über HTTPS.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },

      // 2. Sichere Voreinstellung für alles außer den Eventseiten.
      { source: "/", headers: NO_FRAMING },
      { source: "/:first/:rest+", headers: NO_FRAMING },

      // 3. Öffentliche Eventseiten (app/[slug]) sind einbettbar.
      { source: "/:slug", headers: EMBEDDABLE },

      // 4. Einteilige Seiten des Tools wieder ohne Einbetten. Neue einteilige Routen hier ergänzen
      //    (tests/e2e/headers.spec.ts prüft die ausgelieferten Header).
      { source: "/:page(impressum|datenschutz|logout)", headers: NO_FRAMING },
      // Sensible Bereiche. `/admin/:path*` umfasst auch `/admin` selbst.
      { source: "/admin/:path*", headers: PRIVATE_PAGE },
      { source: "/account", headers: PRIVATE_PAGE },
      { source: "/login", headers: PRIVATE_PAGE },
      { source: "/forgot-password", headers: PRIVATE_PAGE },
      {
        // Der Einmal-Link steht in der URL - er darf weder per Referer weitergegeben
        // noch zwischengespeichert werden.
        source: "/reset-password",
        headers: [...PRIVATE_PAGE, { key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // Hochgeladene Hintergrundbilder (Vorlage, Event, öffentliche Eventseite): Diese Regeln
        // stehen HINTER den allgemeinen und ersetzen deren CSP (sonst ginge die CSP des Route
        // Handlers verloren - Header aus dieser Datei gewinnen). Selbst wenn ein Browser das Bild
        // als Dokument öffnet: keine Skripte, keine Einbettung.
        source: "/admin/:area(plans|events)/:id/background",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }],
      },
      {
        source: "/:slug/background",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }],
      },
      {
        // Persönlicher Verwaltungslink einer Buchung (/b/<bookingId>/<token>, ab Phase 3),
        // siehe docs/KONZEPT.md Abschnitt 6.
        source: "/b/:path*",
        headers: [...PRIVATE_PAGE, { key: "Referrer-Policy", value: "no-referrer" }],
      },

      {
        // 5. Die Föderations-Endpunkte (ab Phase 8) tragen Einmal-Werte (Login-Bestätigung,
        //    state) in der URL. Überschreibt die Referrer-Policy der allgemeinen Regel.
        source: "/api/suite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
