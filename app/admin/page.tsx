// app/admin/page.tsx
import { requireUser } from '../lib/auth'
import EventsOverview from './events/events-overview'

export const dynamic = 'force-dynamic'

/** Start der Verwaltung (Startadresse der App): die Übersicht „Events“, wie /admin/events. */
export default async function AdminPage() {
  const user = await requireUser('/admin')
  return <EventsOverview user={user} deleted={false} />
}
