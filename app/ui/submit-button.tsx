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
      className={`w-full bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 transition disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}
