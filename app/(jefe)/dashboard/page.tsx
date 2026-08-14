import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/supabase/roles'
import { LabUsageTable } from '@/components/dashboard/lab-usage-table'
import { TopFranjas } from '@/components/dashboard/top-franjas'
import {
  SemestreResumen,
  rotuloSemestre,
  type SemestreRow,
} from '@/components/dashboard/semestre-resumen'
import { EstadoCorreo } from '@/components/dashboard/estado-correo'
import { correoConfigurado } from '@/lib/email/resend'


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
  hint,
  accent = 'navy',
}: {
  label: string
  value: string | number
  hint?: string
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
      {hint ? (
        <p className="mt-0.5 font-data text-xs text-[var(--umng-ink)]/50">{hint}</p>
      ) : null}
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


  // v_semestre_resumen: prácticas por semestre (I = ene–jun, II = jul–dic).
  const { data: semestreData, error: semestreError } = await supabase
    .from('v_semestre_resumen')
    .select('*')
    .order('semestre', { ascending: false })


  const usage = (usageData ?? []) as LabUsage[]
  const demanda = (demandaData ?? []) as DemandaRow[]
  const semestres = (semestreData ?? []) as SemestreRow[]


  // El semestre en curso es el primero: la consulta viene ordenada desc.
  const semestreActual = semestres[0] ?? null
  const totalHistorico = semestres.reduce((acc, s) => acc + Number(s.solicitudes ?? 0), 0)


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


  // Asistencia: el porcentaje se calcula SOLO sobre lo efectivamente
  // registrado (asistencias + inasistencias), no sobre todas las aprobadas.
  // Una reserva aprobada sin marcar (attended = null) no cuenta como
  // inasistencia: mostrarla como tal daría una cifra engañosa.
  const totalAsistencias = usage.reduce((acc, l) => acc + (l.asistencias ?? 0), 0)
  const totalInasistencias = usage.reduce((acc, l) => acc + (l.inasistencias ?? 0), 0)
  const totalRegistradas = totalAsistencias + totalInasistencias
  const pctAsistencia =
    totalRegistradas > 0 ? Math.round((totalAsistencias / totalRegistradas) * 100) : null


  const loadError = usageError ?? demandaError ?? semestreError


  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--umng-navy)]">
            Panel de control
          </h1>
          <p className="mt-1 text-sm text-[var(--umng-ink)]/70">
            Vista global de uso de laboratorios y demanda de reservas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/dashboard/personal"
            className="rounded-lg border border-[var(--umng-navy)] px-4 py-2.5 text-sm font-semibold text-[var(--umng-navy)] transition hover:bg-[var(--umng-navy)] hover:text-white"
          >
            Personal
          </a>
          {/* Descarga directa: la ruta genera el .xlsx en el servidor. */}
          <a
            href="/dashboard/export"
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            style={{ backgroundColor: 'var(--umng-green)' }}
          >
            Exportar a Excel
          </a>
        </div>
      </header>


      {loadError ? (
        <p className="rounded-lg border border-[var(--umng-crimson)] bg-red-50 p-4 text-sm text-[var(--umng-ink)]">
          No se pudieron cargar las métricas: {loadError.message}
        </p>
      ) : (
        <div className="space-y-10">
          {/* Estado del correo: arriba a propósito. Si no está configurado,
              es lo primero que el jefe debe ver al entrar. */}
          <EstadoCorreo configurado={correoConfigurado()} />

          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Reservas aprobadas" value={totalAprobadas} accent="green" />
            <StatCard label="Reservas pendientes" value={totalPendientes} accent="gold" />
            <StatCard
              label="Asistencia"
              value={pctAsistencia === null ? '—' : `${pctAsistencia}%`}
              hint={
                totalRegistradas > 0
                  ? `${totalAsistencias} de ${totalRegistradas} registradas`
                  : 'Sin registros'
              }
              accent="green"
            />
            <StatCard label="Laboratorios" value={totalLabs} accent="navy" />
            <StatCard label="Total de reservas" value={totalReservas} accent="navy" />
          </section>


          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-[var(--umng-navy)]">
                  Prácticas por semestre
                </h2>
                <p className="mt-0.5 text-sm text-[var(--umng-ink)]/60">
                  {semestreActual
                    ? `${semestreActual.solicitudes} solicitadas en ${rotuloSemestre(
                        semestreActual.semestre,
                      )} · ${totalHistorico} en el histórico`
                    : 'Sin datos todavía'}
                </p>
              </div>
              {semestreActual ? (
                <a
                  href={`/dashboard/export?semestre=${semestreActual.semestre}`}
                  className="text-sm font-semibold text-[var(--umng-navy)] underline-offset-4 hover:underline"
                >
                  Exportar solo {rotuloSemestre(semestreActual.semestre)}
                </a>
              ) : null}
            </div>
            <SemestreResumen rows={semestres} />
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
