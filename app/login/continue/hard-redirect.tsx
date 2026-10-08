// app/login/continue/hard-redirect.tsx
'use client'

import { useEffect } from 'react'

/**
 * Löst einen echten Seitenwechsel (kein Client-Router-Übergang) aus. Nötig, weil der Next-Client eine
 * Weiterleitung aus einer Server Action als internen Übergang behandelt und einen Route Handler, der
 * seinerseits zu einer anderen Domain weiterleitet, nicht sauber abschließt - die Seite bliebe hängen.
 */
export default function HardRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to)
  }, [to])

  return (
    <p className="text-sm text-gray-600 dark:text-gray-400">
      Du wirst weitergeleitet. Falls nichts passiert:{' '}
      <a href={to} className="text-blue-700 dark:text-blue-300 underline">hier weiter</a>.
    </p>
  )
}
