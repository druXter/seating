// app/admin/events/new/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { requireUser } from '../../../lib/auth'
import { canCreateEvents } from '../../../lib/permissions'
import { baseUrl } from '../../../lib/base-url'
import { CreateEventForm } from '../event-forms'

export const dynamic = 'force-dynamic'

export default async function NewEventPage() {
  const user = await requireUser('/admin/events/new')
  if (!canCreateEvents(user)) redirect('/admin/events')

  // Dieselben Pläne wie unter /admin/plans: eigene und gemeinsame Vorlagen, Admins alle.
  // Die Action prüft die Wahl erneut (loadPlan).
  const plans = await prisma.floorPlan.findMany({
    where: user.role === 'ADMIN' ? {} : { OR: [{ ownerId: user.id }, { shared: true }] },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, ownerId: true, owner: { select: { email: true } } }
  })
  const options = plans.map(plan => ({
    id: plan.id,
    label: plan.ownerId === user.id ? plan.name : `${plan.name} (von ${plan.owner?.email ?? 'gelöschtem Konto'})`
  }))

  return (
    <main className="bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-6 rounded-lg shadow space-y-4 text-gray-900 dark:text-gray-100">
        <h1 className="text-2xl font-bold">Neues Event</h1>
        {options.length === 0 ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Ein Event braucht einen Raumplan. <Link href="/admin/plans/new" className="text-blue-700 dark:text-blue-300 hover:underline">Lege zuerst einen Raumplan an</Link>.
          </p>
        ) : (
          <CreateEventForm plans={options} baseUrl={baseUrl()} />
        )}
      </div>
    </main>
  )
}
