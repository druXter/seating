// app/ui/notice.tsx

const TONES = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-900'
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
