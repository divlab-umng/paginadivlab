import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/supabase/roles'
import { LabUsageTable } from '@/components/dashboard/lab-usage-table'
import { TopFranjas } from '@/components/dashboard/top-franjas'


export const dynamic = 'force-dynamic'


// Filas de v_lab_usage (una por laboratorio).
type LabUsage = {
  lab_id: string
  code: string
  name: string
  reservas_aprobadas: number
  reservas_pendientes: number
  reservas_rechazadas: number
  reservas_canceladas: number
  asistencias: number
  inasistencias: number
}


// Filas de v_demanda_horaria (una por lab + día + hora).
type DemandaRow = {
  lab_id: string
  dia_semana: number
  start_time: string
  solicitudes: number
}


function StatCard({
  label,
  value,
  accent = 'navy',
}: {
  label: string
  value: string | number
  accent?: 'navy' | 'gold' | 'crimson' | 'green'
}) {
  const accentVar =
    accent === 'gold'
      ? 'var(--umng-gold)'
      : accent === 'crimson'
        ? 'var(--umng-crimson)'
        : accent === 'green'
          ? 'var(--umng-green)'
          : 'var(--umng-navy)'


  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="h-1 w-10 rounded" style={{ backgroundColor: accentVar }} />
      <p className="mt-3 font-data text-3xl font-bold text-[var(--umng-ink)]">{value}</p>
      <p className="mt-1 text-sm text-[var(--umng-ink)]/70">{label}</p>
    </div>
  )
}


export default async function DashboardPage() {
  const supabase = await createClient()


  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')


  // Solo el jefe ve el dashboard global. Otros roles → su propia home.
  const role = await getUserRole(supabase, user.id)
  if (role !== 'jefe') redirect('/')


  // v_lab_usage: una fila por lab con contadores por estado.
  const { data: usageData, error: usageError } = await supabase
    .from('v_lab_usage')
    .select('*')


  // v_demanda_horaria: demanda por lab + día + franja.
  const { data: demandaData, error: demandaError } = await supabase
    .from('v_demanda_horaria')
    .select('*')


  const usage = (usageData ?? []) as LabUsage[]
  const demanda = (demandaData ?? []) as DemandaRow[]


  // Mapa lab_id -> nombre, para que el ranking de franjas muestre nombres
  // (v_demanda_horaria solo trae lab_id).
  const labNames: Record<string, string> = Object.fromEntries(
    usage.map((l) => [l.lab_id, l.name]),
  )


  // Métricas resumen (suma sobre todos los labs).
  const totalAprobadas = usage.reduce((acc, l) => acc + (l.reservas_aprobadas ?? 0), 0)
  const totalPendientes = usage.reduce((acc, l) => acc + (l.reservas_pendientes ?? 0), 0)
  const totalRechazadas = usage.reduce((acc, l) => acc + (l.reservas_rechazadas ?? 0), 0)
  const totalCanceladas = usage.reduce((acc, l) => acc + (l.reservas_canceladas ?? 0), 0)
  const totalReservas = totalAprobadas + totalPendientes + totalRechazadas + totalCanceladas
  const totalLabs = usage.length


  const loadError = usageError ?? demandaError


  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="font-display text-2xl font-bold text-[var(--umng-navy)]">
          Panel de control
        </h1>
        <p className="mt-1 text-sm text-[var(--umng-ink)]/70">
          Vista global de uso de laboratorios y demanda de reservas.
        </p>
      </header>


      {loadError ? (
        <p className="rounded-lg border border-[var(--umng-crimson)] bg-red-50 p-4 text-sm text-[var(--umng-ink)]">
          No se pudieron cargar las métricas: {loadError.message}
        </p>
      ) : (
        <div className="space-y-10">
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Reservas aprobadas" value={totalAprobadas} accent="green" />
            <StatCard label="Reservas pendientes" value={totalPendientes} accent="gold" />
            <StatCard label="Laboratorios" value={totalLabs} accent="navy" />
            <StatCard label="Total de reservas" value={totalReservas} accent="navy" />
          </section>


          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-[var(--umng-navy)]">
              Uso por laboratorio
            </h2>
            <LabUsageTable rows={usage} />
          </section>


          <section>
            <h2 className="mb-3 font-display text-lg font-semibold text-[var(--umng-navy)]">
              Franjas más demandadas
            </h2>
            <TopFranjas rows={demanda} labNames={labNames} />
          </section>
        </div>
      )}
    </main>
  )
}
