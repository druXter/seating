// app/ui/pwa-register.tsx
'use client'

import { useEffect } from 'react'

/**
 * Meldet den Service Worker (public/sw.js) an. Nur in der Produktion: Im Entwicklungsmodus würde ein
 * aktiver Worker Seitenwechsel verfälschen und Fehlersuche erschweren. Nicht in einem iFrame - die
 * öffentlichen Eventseiten lassen sich einbetten, dort bringt ein Worker nichts. Ein Fehlschlag
 * (alter Browser, kein HTTPS) ist unkritisch - die App funktioniert dann ganz normal ohne
 * Installierbarkeit. `updateViaCache: 'none'` sorgt dafür, dass eine neue sw.js sofort erkannt wird.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator) || window.self !== window.top) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
  }, [])

  return null
}
