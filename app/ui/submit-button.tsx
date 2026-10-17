// app/ui/submit-button.tsx

/**
 * Einheitlicher primärer Speichern-/Absenden-Button - gleiches Prinzip wie in
 * rsvp-app und dem Abstimmungstool, damit die Tools der Suite optisch
 * zusammenpassen.
 */
export default function SubmitButton({
  children,
  disabled = false,
  className = ''
}: {
  children: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={`w-full rounded-lg border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  )
}
