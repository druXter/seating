// app/ui/booking-status-badge.tsx
import type { BookingStatus } from '@prisma/client'
import { BOOKING_STATUS_LABELS } from '../lib/events/admin-rules'
import { Badge, type Tone } from './kit'

const TONE: Record<BookingStatus, Tone> = {
  CONFIRMED: 'green', PENDING: 'amber', OFFERED: 'amber', WAITLISTED: 'blue', CANCELLED: 'gray', EXPIRED: 'gray'
}

/** Status einer Buchung (Anzeige-Status, abgelaufene Holds also schon als "verfallen", siehe effectiveStatus). */
export default function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={TONE[status]}>{BOOKING_STATUS_LABELS[status]}</Badge>
}
