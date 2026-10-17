// app/ui/status-badge.tsx
import type { EventStatus } from '@prisma/client'
import { STATUS_LABELS } from '../lib/events/settings'
import { Badge, type Tone } from './kit'

const TONE: Record<EventStatus, Tone> = { DRAFT: 'gray', OPEN: 'green', CLOSED: 'amber', ARCHIVED: 'gray' }

export default function StatusBadge({ status }: { status: EventStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABELS[status]}</Badge>
}
