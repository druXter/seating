// app/admin/plans/new/page.tsx
import { redirect } from 'next/navigation'
import { requireUser } from '../../../lib/auth'
import { canCreatePlans } from '../../../lib/permissions'
import { CreatePlanForm, ImportPlanForm } from './plan-forms'

export const dynamic = 'force-dynamic'

export default async function NewPlanPage() {
  const user = await requireUser('/admin/plans/new')
  if (!canCreatePlans(user)) redirect('/admin')

  return (
    <main className="bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto grid gap-6 md:grid-cols-2 text-gray-900">
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h1 className="text-xl font-bold">Neuer Raumplan</h1>
          <CreatePlanForm />
        </div>
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <h2 className="text-xl font-bold">Importieren</h2>
          <ImportPlanForm />
        </div>
      </div>
    </main>
  )
}
