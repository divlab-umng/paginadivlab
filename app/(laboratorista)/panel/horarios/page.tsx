import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BlockForm } from '@/components/panel/block-form'
import { BlockList } from '@/components/panel/block-list'
import { GroupPolicyForm } from '@/components/panel/group-policy-form'
import { SafetyNotesForm } from '@/components/panel/safety-notes-form'

export const dynamic = 'force-dynamic'

type Lab = { id: string; code: string; name: string }
type Block = {
  id: string
  lab_id: string
  weekday: number
  start_time: string
  end_time: string
  capacity: number
  workstations: number | null
}

export default async function HorariosPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: labsData } = await supabase.rpc('my_admin_labs')
  const misLabs = (labsData ?? []) as Lab[]

  let blocks: Block[] = []
  // Política de grupos e instrucciones por lab: my_admin_labs no las trae.
  const politicas = new Map<string, number | null>()
  const instrucciones = new Map<string, string | null>()
  const labIds = misLabs.map((l) => l.id)
  if (labIds.length > 0) {
    const { data } = await supabase
      .from('schedule_blocks')
      .select('id, lab_id, weekday, start_time, end_time, capacity, workstations')
      .in('lab_id', labIds)
      .eq('is_active', true)
      .order('weekday')
      .order('start_time')
    blocks = (data ?? []) as Block[]

    const { data: labsInfo } = await supabase
      .from('laboratories')
      .select('id, max_group_size, safety_notes')
      .in('id', labIds)
    for (const l of labsInfo ?? []) {
      politicas.set(l.id as string, (l.max_group_size as number | null) ?? null)
      instrucciones.set(l.id as string, (l.safety_notes as string | null) ?? null)
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <a href="/panel" className="text-sm text-[var(--umng-navy)] hover:underline">
          ← Volver al panel
        </a>
        <h1 className="mt-2 font-display text-2xl font-bold text-[var(--umng-navy)]">
          Horarios de laboratorio
        </h1>
        <p className="mt-1 text-sm text-[var(--umng-ink)]/70">
          Define los bloques fijos en los que los estudiantes pueden reservar aforo.
          Al crear un bloque, las sesiones de las próximas 8 semanas se generan
          automáticamente.
        </p>
      </header>

      {misLabs.length === 0 ? (
        <p className="rounded-lg border border-[var(--umng-gold)] bg-amber-50 p-4 text-sm text-[var(--umng-ink)]">
          No tienes laboratorios asignados. Pide al jefe que te asigne uno.
        </p>
      ) : (
        <div className="space-y-10">
          {misLabs.map((lab) => (
            <section key={lab.id} className="rounded-xl border border-gray-200 p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-display text-lg font-semibold text-[var(--umng-navy)]">
                  {lab.name}
                </h2>
                <span className="font-data text-xs text-[var(--umng-ink)]/60">{lab.code}</span>
              </div>

              <BlockList blocks={blocks.filter((b) => b.lab_id === lab.id)} />

              <div className="mt-6 border-t border-gray-100 pt-6">
                <h3 className="mb-3 text-sm font-semibold text-[var(--umng-ink)]">Nuevo bloque</h3>
                <BlockForm labId={lab.id} />
              </div>

              {/* Grupos de trabajo: solo tiene sentido donde los puestos son
                  el recurso escaso (mesas, tornos, celdas de manufactura). */}
              <div className="mt-6 border-t border-gray-100 pt-6">
                <h3 className="mb-3 text-sm font-semibold text-[var(--umng-ink)]">
                  Grupos de trabajo
                </h3>
                <GroupPolicyForm
                  labId={lab.id}
                  actual={politicas.get(lab.id) ?? null}
                />
              </div>

              {/* Lo que el estudiante recibe por correo al aprobarle la práctica */}
              <div className="mt-6 border-t border-gray-100 pt-6">
                <h3 className="mb-3 text-sm font-semibold text-[var(--umng-ink)]">
                  Instrucciones de ingreso
                </h3>
                <SafetyNotesForm
                  labId={lab.id}
                  actual={instrucciones.get(lab.id) ?? null}
                />
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
