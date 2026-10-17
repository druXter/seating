// app/admin/events/new/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '../../../lib/prisma'
import { requireUser } from '../../../lib/auth'
import { canCreateEvents } from '../../../lib/permissions'
import { baseUrl } from '../../../lib/base-url'
import { CreateEventForm } from '../event-forms'
import { Card, Main, PageHeader } from '../../../ui/kit'

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
    <Main width="narrow">
      <PageHeader back={{ href: '/admin', label: 'Alle Events' }} title="Neues Event" />
      <Card className="space-y-4">
        {options.length === 0 ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Ein Event braucht einen Raumplan. <Link href="/admin/plans/new" className="text-blue-700 dark:text-blue-300 hover:underline">Lege zuerst einen Raumplan an</Link>.
          </p>
        ) : (
          <CreateEventForm plans={options} baseUrl={baseUrl()} />
        )}
      </Card>
    </Main>
  )
}
