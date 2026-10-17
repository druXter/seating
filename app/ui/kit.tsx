// app/ui/kit.tsx
//
// Grundbausteine der Oberfläche (docs/KONZEPT-OBERFLAECHE.md), dieselben wie in rsvp-app, Abstimmungstool, Schichten
// und Zeitplan: ruhig, weiß/grau mit Blau als einziger Akzentfarbe für Hauptaktionen; Farbe trägt Bedeutung nur in
// Badges (grün = veröffentlicht/bestätigt, amber = geschlossen/unbestätigt, blau = Warteliste, grau = Entwurf/archiviert,
// türkis = freigegeben, pink = rsvp-app, lila = interne Notiz).
// Server- und Client-tauglich (keine Hooks). Abweichung: Eingabefelder auf dem Handy in 16px, damit iOS beim
// Antippen nicht hineinzoomt.
import Link from 'next/link'
import type { ReactNode } from 'react'
import Disclosure from './disclosure'

export type Tone = 'gray' | 'green' | 'orange' | 'red' | 'blue' | 'indigo' | 'pink' | 'amber' | 'purple' | 'lime' | 'teal'

const BADGE: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/60 dark:text-pink-200',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200',
  lime: 'bg-lime-100 text-lime-800 dark:bg-lime-900/60 dark:text-lime-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200'
}

export function Badge({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE[tone]}`}>{children}</span>
}

export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm ${padded ? 'p-5' : ''} ${className}`}>{children}</div>
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border border-blue-600',
  secondary: 'bg-white text-gray-800 hover:bg-gray-50 border border-gray-300 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700',
  ghost: 'text-gray-700 hover:bg-gray-100 border border-transparent dark:text-gray-200 dark:hover:bg-gray-700',
  danger: 'bg-white text-red-700 hover:bg-red-50 border border-red-300 dark:bg-gray-800 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-950'
}

/** Klassen für Knöpfe und Links, die wie Knöpfe aussehen. */
export function buttonClass(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md') {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-60 whitespace-nowrap ${size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'} ${VARIANT[variant]}`
}

export function ButtonLink({ href, children, variant = 'secondary', size = 'md', external = false }: { href: string; children: ReactNode; variant?: Variant; size?: 'sm' | 'md'; external?: boolean }) {
  return external
    ? <a href={href} target="_blank" rel="noopener" className={buttonClass(variant, size)}>{children}</a>
    : <Link href={href} className={buttonClass(variant, size)}>{children}</Link>
}

export const inputClass = 'w-full rounded-lg border border-gray-300 bg-white p-2 text-base sm:text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:ring-blue-900'
export const labelClass = 'block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1'
export const hintClass = 'text-xs text-gray-500 dark:text-gray-400 mt-1'

/** Kennzahl mit Beschriftung, optional mit Fortschrittsbalken (z. B. Plätze belegt). */
export function Stat({ label, value, hint, tone, progress, testId }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; progress?: { value: number; max: number } | null; testId?: string }) {
  const color = tone === 'red' ? 'text-red-700 dark:text-red-300' : tone === 'orange' ? 'text-orange-700 dark:text-orange-300' : tone === 'green' ? 'text-green-700 dark:text-green-300' : 'text-gray-900 dark:text-gray-100'
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4" data-testid={testId}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
      {progress && <ProgressBar value={progress.value} max={progress.max} />}
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  )
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full ${percent >= 100 ? 'bg-orange-500' : 'bg-blue-600'}`} style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Kopf einer Seite: Titel, Untertitel, Aktionen rechts (auf dem Handy darunter). */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 print:mb-2">
      {back && <Link href={back.href} className="text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 print:hidden">← {back.label}</Link>}
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 break-words">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>}
      </div>
    </div>
  )
}

/**
 * Einklappbarer Abschnitt der Einstellungen: Titel (als Überschrift), kurzer Stand ("aus", "nur mit Code") und eine kleine
 * Themenmarke. Inhalt bleibt im DOM (Formularfelder werden mitgeschickt, auch wenn zugeklappt). `open` gilt nur beim
 * ersten Anzeigen (Disclosure), danach bestimmt die Person.
 */
export function SettingsSection({ id, title, summary, marker, open = false, description, children }: {
  id: string; title: string; summary?: ReactNode; marker?: Tone; open?: boolean; description?: ReactNode; children: ReactNode
}) {
  return (
    <Disclosure id={id} defaultOpen={open} className="group rounded-xl border border-gray-200 bg-white shadow-sm open:shadow dark:border-gray-700 dark:bg-gray-800 scroll-mt-20" testId={`section-${id}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 select-none">
        {marker && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${MARKER[marker]}`} aria-hidden />}
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
        {summary && <span className="ml-auto truncate text-sm text-gray-500 dark:text-gray-400">{summary}</span>}
        <span className={`${summary ? '' : 'ml-auto'} text-gray-400 transition group-open:rotate-90`} aria-hidden>▸</span>
      </summary>
      <div className="space-y-4 border-t border-gray-100 px-5 py-4 dark:border-gray-700">
        {description && <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>}
        {children}
      </div>
    </Disclosure>
  )
}

const MARKER: Record<Tone, string> = {
  gray: 'bg-gray-400', green: 'bg-green-500', orange: 'bg-orange-500', red: 'bg-red-500', blue: 'bg-blue-500', indigo: 'bg-indigo-500',
  pink: 'bg-pink-500', amber: 'bg-amber-500', purple: 'bg-purple-500', lime: 'bg-lime-500', teal: 'bg-teal-500'
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">{children}</p>
}

/** Inhaltsbereich einer Seite: "wide" für Listen und Übersichten, "narrow" für Formulare, "full" für den Plan-Editor. */
export function Main({ children, width = 'wide' }: { children: ReactNode; width?: 'wide' | 'narrow' | 'full' }) {
  return <main className={`mx-auto w-full px-4 py-6 sm:py-8 print:max-w-none print:p-0 ${width === 'narrow' ? 'max-w-3xl' : width === 'full' ? 'max-w-7xl' : 'max-w-5xl'} text-gray-900 dark:text-gray-100`}>{children}</main>
}

/** Überschrift eines Abschnitts in Listen ("Aktuell", "Vergangen"). */
export const sectionTitleClass = 'mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400'

/** Umschalter zwischen Ansichten einer Seite (Spuren, Druckarten), als Links; auf dem Handy seitlich scrollbar. */
export function Segmented({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex max-w-full overflow-x-auto rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800 w-fit">
      {items.map(item => (
        <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}
          className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${item.active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700'}`}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
