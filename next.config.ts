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

const nextConfig: NextConfig = {
  // REIHENFOLGE IST WICHTIG: Passen mehrere Regeln auf denselben Pfad und setzen denselben
  // Header, gewinnt die SPÄTERE (siehe node_modules/next/dist/docs/01-app/03-api-reference/
  // 05-config/01-next-config-js/headers.md, "Header Overriding Behavior"). Deshalb:
  //
  //   1. allgemeine Regel für alles
  //   2. (Phase 2) Ausnahme für öffentliche Eventseiten /:slug, die einbettbar sein sollen
  //      (wie in rsvp-app). ACHTUNG: /:slug passt auch auf /admin, /login, /account ...
  //   3. danach die sensiblen Bereiche, die das Einbetten wieder verbieten - sie stehen
  //      bewusst HINTER Regel 2, damit sie deren Freigabe überschreiben.
  //   4. Föderations-Endpunkte (Referrer-Policy)
  //
  // Nicht gesetzt: eine vollständige Content-Security-Policy. Sie würde für Next.js Nonces
  // pro Anfrage brauchen (siehe node_modules/next/dist/docs/01-app/02-guides/
  // content-security-policy.md) und alle Seiten dynamisch machen - der Nutzen ist gering,
  // da nirgends fremder Inhalt als HTML ausgegeben wird (React maskiert alles).
  async headers() {
    return [
      {
        // 1. Allgemein. frame-ancestors 'none' gilt vorerst überall (sichere Voreinstellung),
        //    bis Phase 2 die Eventseiten gezielt freigibt.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...NO_FRAMING,
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Nur für diesen Host (ohne includeSubDomains), damit andere Subdomains der
          // Suite davon unberührt bleiben. Wirkt nur über HTTPS.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },

      // 2. (Phase 2) { source: "/:slug", headers: [ ...einbettbar... ] } - HIER einfügen.

      // 3. Sensible Bereiche. `/admin/:path*` umfasst auch `/admin` selbst.
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
        // Hochgeladene Hintergrundbilder: Diese Regel steht HINTER /admin/:path* und ersetzt deren
        // CSP (sonst ginge die CSP des Route Handlers verloren - Header aus dieser Datei gewinnen).
        // Selbst wenn ein Browser das Bild als Dokument öffnet: keine Skripte, keine Einbettung.
        source: "/admin/plans/:id/background",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }],
      },
      {
        // Persönlicher Verwaltungslink einer Buchung (/b/<bookingId>/<token>, ab Phase 3),
        // siehe docs/KONZEPT.md Abschnitt 6.
        source: "/b/:path*",
        headers: [...PRIVATE_PAGE, { key: "Referrer-Policy", value: "no-referrer" }],
      },

      {
        // 4. Die Föderations-Endpunkte (ab Phase 8) tragen Einmal-Werte (Login-Bestätigung,
        //    state) in der URL. Überschreibt die Referrer-Policy der allgemeinen Regel.
        source: "/api/suite/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
