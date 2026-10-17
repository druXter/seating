// app/ui/notice.tsx

const TONES = {
  info: 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-900',
  success: 'bg-green-50 text-green-900 border-green-200 dark:bg-green-950 dark:text-green-100 dark:border-green-900',
  warning: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-900',
  error: 'bg-red-50 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-100 dark:border-red-900'
} as const

/** Einheitliche Hinweisbox für Rückmeldungen nach einer Aktion (gleiche Farben wie rsvp-app und Abstimmungstool). */
export default function Notice({
  tone = 'info',
  children
}: {
  tone?: keyof typeof TONES
  children: React.ReactNode
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${TONES[tone]}`}>
      {children}
    </div>
  )
}
