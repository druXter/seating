import type { NextConfig } from "next";
import { BASE_RULE, EMBEDDABLE, NO_FRAMING, NO_REFERRER, PRIVATE_PAGE, SECRET_URL_PAGE, SERVICE_WORKER } from "suite-kit/web";

// Header-Bausteine aus suite-kit (docs/KONVENTIONEN.md, "Sicherheits-Header"); hier stehen nur die Pfade dieses Tools.
// EMBEDDABLE (frame-ancestors *) für die öffentlichen Eventseiten wie in rsvp-app, z.B. als iFrame in ein CMS. Fest im
// Code statt per Env: Die Regeln werden beim Build festgeschrieben. Wer nur bestimmte Seiten einbetten lassen will,
// ersetzt EMBEDDABLE durch eine Regel mit deren Origin(s) und baut neu.
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
  //   6. Service Worker der installierbaren App (nie cachen, eigene CSP)
  //
  // Nicht gesetzt: eine vollständige Content-Security-Policy. Sie würde für Next.js Nonces
  // pro Anfrage brauchen (siehe node_modules/next/dist/docs/01-app/02-guides/
  // content-security-policy.md) und alle Seiten dynamisch machen - der Nutzen ist gering,
  // da nirgends fremder Inhalt als HTML ausgegeben wird (React maskiert alles).
  async headers() {
    return [
      // 1. Allgemein.
      BASE_RULE,

      // 2. Sichere Voreinstellung für alles außer den Eventseiten.
      { source: "/", headers: NO_FRAMING },
      { source: "/:first/:rest+", headers: NO_FRAMING },

      // 3. Öffentliche Eventseiten (app/[slug]) sind einbettbar.
      { source: "/:slug", headers: EMBEDDABLE },

      // 4. Einteilige Seiten des Tools wieder ohne Einbetten. Neue einteilige Routen hier ergänzen
      //    (tests/e2e/headers.spec.ts prüft die ausgelieferten Header).
      { source: "/:page(impressum|datenschutz|logout)", headers: NO_FRAMING },
      // Offline-Seite der installierten App (public/offline.html, siehe public/sw.js).
      { source: "/offline.html", headers: NO_FRAMING },
      // Sensible Bereiche. `/admin/:path*` umfasst auch `/admin` selbst.
      { source: "/admin/:path*", headers: PRIVATE_PAGE },
      { source: "/account", headers: PRIVATE_PAGE },
      // `/login/:path*` umfasst `/login` und die Zwischenseite `/login/continue` (Föderation, Phase 8).
      { source: "/login/:path*", headers: PRIVATE_PAGE },
      { source: "/forgot-password", headers: PRIVATE_PAGE },
      // Der Einmal-Link steht in der URL - er darf weder per Referer weitergegeben noch zwischengespeichert werden.
      { source: "/reset-password", headers: SECRET_URL_PAGE },
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
        // Persönlicher Verwaltungslink einer Buchung (/b/<bookingId>/<token>) und der Link aus der
        // Verifizierungsmail (/verify/<bookingId>/<token>), siehe docs/KONZEPT.md Abschnitt 6, und der
        // Einstieg aus rsvp-app mit signiertem Link (/rsvp/<eventId>?t=..., Abschnitt 9).
        source: "/:area(b|verify|rsvp)/:path*",
        headers: SECRET_URL_PAGE,
      },

      {
        // 5. Die Föderations-Endpunkte (Phase 8) tragen Einmal-Werte (Login-Bestätigung,
        //    state) in der URL. Überschreibt die Referrer-Policy der allgemeinen Regel.
        source: "/api/suite/:path*",
        headers: NO_REFERRER,
      },

      {
        // 6. Der Service Worker (public/sw.js) darf NIE aus einem Cache kommen (Browser, Cloudflare),
        //    sonst blieben Nutzer*innen auf einer alten Version hängen. Eigene CSP: Er lädt nur
        //    Ressourcen derselben Herkunft. Steht NACH Regel 3 (/:slug passt auch auf /sw.js) und
        //    ersetzt deren CSP.
        source: "/sw.js",
        headers: SERVICE_WORKER,
      },
    ];
  },
};

export default nextConfig;
