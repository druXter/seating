// public/sw.js
// Bewusst schlanker Service Worker (wie im Abstimmungstool) - er macht die App installierbar und
// zeigt bei fehlender Verbindung eine freundliche Offline-Seite statt der Fehlerseite des Browsers.
//
// NICHTS Persönliches wird zwischengespeichert: Seiten dieses Tools enthalten Konto-Daten,
// Buchungslisten mit Namen und Adressen, Verwaltungs- und Bestätigungslinks. Ein Cache davon würde
// auf einem geteilten Gerät auch nach dem Abmelden lesbar bleiben. Deshalb gilt:
//   - Navigationen gehen IMMER ans Netz (kein Cache, kein "stale"), nur bei einem Netzwerkfehler
//     kommt die vorab geladene Offline-Seite.
//   - Alles andere (Server Actions/POST, /api/*, RSC-Anfragen, Bilder, fremde Herkunft) fasst dieser
//     Worker gar nicht an - der Browser verhält sich wie ohne Service Worker.
// Im Cache liegt ausschließlich die statische Offline-Seite. Ändert sich /offline.html, VERSION erhöhen.

const VERSION = 'v1'
const CACHE = `seating-offline-${VERSION}`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('seating-offline-') && key !== CACHE) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.mode !== 'navigate' || request.method !== 'GET') return

  const url = new URL(request.url)
  // /api/* (u.a. Export-Downloads und der Anmelde-Ablauf mit anderen Tools, der auf fremde Domains
  // weiterleitet) gehört dem Browser.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  event.respondWith((async () => {
    try {
      return await fetch(request)
    } catch {
      return (await caches.match(OFFLINE_URL)) || Response.error()
    }
  })())
})
