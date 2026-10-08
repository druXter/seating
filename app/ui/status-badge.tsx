// app/ui/status-badge.tsx
import type { EventStatus } from '@prisma/client'
import { STATUS_LABELS } from '../lib/events/settings'

const STYLE: Record<EventStatus, string> = {
  DRAFT: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
  OPEN: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  CLOSED: 'bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-200',
  ARCHIVED: 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
}

export default function StatusBadge({ status }: { status: EventStatus }) {
  return <span className={`text-xs rounded px-1.5 py-0.5 ${STYLE[status]}`}>{STATUS_LABELS[status]}</span>
}
