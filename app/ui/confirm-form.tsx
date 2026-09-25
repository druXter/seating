// app/ui/confirm-form.tsx
'use client'

/**
 * Formular, das vor dem Absenden nachfragt (z.B. beim Löschen eines Kontos). Muss eine
 * Client-Komponente sein, weil der Bestätigungsdialog ein Event-Handler ist - die Server
 * Action und die versteckten Felder kommen von der Server-Komponente, die dies einbindet.
 */
export default function ConfirmForm({
  action,
  message,
  children
}: {
  action: (formData: FormData) => void | Promise<void>
  message: string
  children: React.ReactNode
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(message)) e.preventDefault()
      }}
    >
      {children}
    </form>
  )
}
