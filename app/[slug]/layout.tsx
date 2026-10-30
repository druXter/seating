// app/[slug]/layout.tsx
import type { ReactNode } from 'react'
import { EmbedHeight } from '../ui/kit'

/**
 * Öffentliche Eventseite: einbettbar (EMBEDDABLE in next.config.ts). EmbedHeight meldet eingebettet die Höhe an die einbettende Seite
 * (suite-kit, Idee Q10), damit das iFrame mitwächst; ohne iFrame passiert nichts. Unterseiten, die nicht einbettbar
 * sind, laden in keinem Rahmen - dort bleibt es wirkungslos.
 */
export default function EmbeddableLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <EmbedHeight />
    </>
  )
}
