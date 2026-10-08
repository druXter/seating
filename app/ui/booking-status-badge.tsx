// app/ui/booking-status-badge.tsx
import type { BookingStatus } from '@prisma/client'
import { BOOKING_STATUS_LABELS } from '../lib/events/admin-rules'

const STYLE: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
  PENDING: 'bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-200',
  OFFERED: 'bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-200',
  WAITLISTED: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200',
  CANCELLED: 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300',
  EXPIRED: 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
}

/** Status einer Buchung (Anzeige-Status, abgelaufene Holds also schon als "verfallen", siehe effectiveStatus). */
export default function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`text-xs rounded px-1.5 py-0.5 whitespace-nowrap ${STYLE[status]}`}>{BOOKING_STATUS_LABELS[status]}</span>
}
