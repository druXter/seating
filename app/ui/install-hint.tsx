// app/ui/install-hint.tsx
'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

// Chromium-Browser (Android, Desktop) kündigen die Installierbarkeit mit diesem - noch nicht
// standardisierten - Ereignis an. Safari/iOS kennt es nicht, dort hilft nur ein Hinweistext.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/**
 * Kleiner, dezenter Hinweis auf der Start- und der Verwaltungsseite (übernommen aus dem
 * Abstimmungstool): "App installieren" (Chromium) bzw. eine Anleitung für iPhone/iPad. Erscheint nicht, wenn die App schon als eigenes Fenster läuft oder der Browser
 * keine Installation anbietet - dann bleibt die Seite unverändert.
 */
const noopSubscribe = () => () => {}

function subscribeDisplayMode(onChange: () => void) {
  const media = window.matchMedia('(display-mode: standalone)')
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export default function InstallHint() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)

  // Browser-Werte über useSyncExternalStore: Der Server-Snapshot ("läuft schon als App", "kein iOS")
  // sorgt dafür, dass beim Server-Rendern und bis zur Hydration nichts erscheint - kein Flackern.
  const isStandalone = useSyncExternalStore(
    subscribeDisplayMode,
    () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => true
  )
  const isIos = useSyncExternalStore(noopSubscribe, () => /iPad|iPhone|iPod/.test(navigator.userAgent), () => false)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault() // Browser-eigene Mini-Leiste unterdrücken, wir zeigen unseren Hinweis
      setInstallEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => setInstallEvent(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (isStandalone) return null

  if (installEvent) {
    return (
      <button
        type="button"
        onClick={async () => {
          await installEvent.prompt()
          await installEvent.userChoice
          setInstallEvent(null)
        }}
        className="text-sm text-blue-700 hover:underline"
      >
        📲 Als App installieren
      </button>
    )
  }

  if (isIos) {
    return (
      <p className="text-xs text-gray-600">
        Als App auf den Home-Bildschirm: in Safari auf <span aria-hidden="true">⎋</span> &quot;Teilen&quot; tippen und
        dann &quot;Zum Home-Bildschirm&quot; wählen.
      </p>
    )
  }

  return null
}
