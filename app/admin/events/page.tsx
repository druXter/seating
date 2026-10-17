// app/admin/events/page.tsx
import { requireUser } from '../../lib/auth'
import EventsOverview from './events-overview'

export const dynamic = 'force-dynamic'

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const user = await requireUser('/admin/events')
  const { deleted } = await searchParams
  return <EventsOverview user={user} deleted={deleted === '1'} />
}
