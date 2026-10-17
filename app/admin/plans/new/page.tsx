// app/admin/plans/new/page.tsx
import { Card, Main, PageHeader } from '../../../ui/kit'
import { redirect } from 'next/navigation'
import { requireUser } from '../../../lib/auth'
import { canCreatePlans } from '../../../lib/permissions'
import { CreatePlanForm, ImportPlanForm } from './plan-forms'

export const dynamic = 'force-dynamic'

export default async function NewPlanPage() {
  const user = await requireUser('/admin/plans/new')
  if (!canCreatePlans(user)) redirect('/admin')

  return (
    <Main>
      <PageHeader back={{ href: '/admin/plans', label: 'Alle Raumpläne' }} title="Neuer Raumplan" />
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Card className="space-y-4">
          <h2 className="font-semibold">Leer anlegen</h2>
          <CreatePlanForm />
        </Card>
        <Card className="space-y-4">
          <h2 className="font-semibold">Importieren</h2>
          <ImportPlanForm />
        </Card>
      </div>
    </Main>
  )
}
