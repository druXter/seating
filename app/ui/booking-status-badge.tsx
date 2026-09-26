// app/ui/booking-status-badge.tsx
import type { BookingStatus } from '@prisma/client'
import { BOOKING_STATUS_LABELS } from '../lib/events/admin-rules'

const STYLE: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-green-100 text-green-800',
  PENDING: 'bg-amber-100 text-amber-900',
  OFFERED: 'bg-amber-100 text-amber-900',
  WAITLISTED: 'bg-blue-100 text-blue-800',
  CANCELLED: 'bg-gray-200 text-gray-700',
  EXPIRED: 'bg-gray-200 text-gray-700'
}

/** Status einer Buchung (Anzeige-Status, abgelaufene Holds also schon als "verfallen", siehe effectiveStatus). */
export default function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`text-xs rounded px-1.5 py-0.5 whitespace-nowrap ${STYLE[status]}`}>{BOOKING_STATUS_LABELS[status]}</span>
}
