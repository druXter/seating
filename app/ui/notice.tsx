// app/ui/notice.tsx

const TONES = {
  success: 'bg-green-50 dark:bg-green-950/50 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200',
  error: 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
  info: 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
  warning: 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
} as const

/** Einheitliche Hinweisbox für Rückmeldungen nach einer Aktion (Erfolg, Fehler, Info). */
export default function Notice({
  tone = 'info',
  children
}: {
  tone?: keyof typeof TONES
  children: React.ReactNode
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`border p-3 rounded text-sm ${TONES[tone]}`}>
      {children}
    </div>
  )
}
