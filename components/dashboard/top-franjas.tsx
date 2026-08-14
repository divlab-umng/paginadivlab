// Top de franjas horarias más demandadas (capa 3 del dashboard del jefe).
// Server Component puro. Recibe las filas de v_demanda_horaria y un mapa
// lab_id -> nombre (la vista solo trae lab_id, no el nombre), ambos preparados
// desde la página. Muestra las N franjas con más solicitudes activas.


type DemandaRow = {
  lab_id: string
  dia_semana: number // ISO: 1=Lunes … 7=Domingo
  start_time: string
  solicitudes: number
}


const DIA_LABEL: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
}


const hhmm = (t: string) => (t ? t.slice(0, 5) : t)


export function TopFranjas({
  rows,
  labNames,
  limit = 10,
}: {
  rows: DemandaRow[]
  labNames: Record<string, string>
  limit?: number
}) {
  // Solo franjas con demanda real, ordenadas por solicitudes desc.
  const ranked = [...rows]
    .filter((r) => (r.solicitudes ?? 0) > 0)
    .sort((a, b) => (b.solicitudes ?? 0) - (a.solicitudes ?? 0))
    .slice(0, limit)


  if (ranked.length === 0) {
    return (
      <p className="text-sm text-[var(--umng-ink)]/60">
        Aún no hay demanda registrada en ninguna franja.
      </p>
    )
  }


  // Para la barra de proporción visual, relativa al máximo del ranking.
  const max = ranked[0].solicitudes ?? 1


  return (
    <ul className="space-y-2">
      {ranked.map((r) => {
        const pct = Math.round((100 * (r.solicitudes ?? 0)) / max)
        const labName = labNames[r.lab_id] ?? r.lab_id
        return (
          <li
            key={`${r.lab_id}-${r.dia_semana}-${r.start_time}`}
            className="rounded-lg border border-gray-200 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--umng-ink)]">
                  {labName}
                </span>
                <span className="font-data text-xs text-[var(--umng-ink)]/60">
                  {DIA_LABEL[r.dia_semana] ?? '—'} · {hhmm(r.start_time)}
                </span>
              </div>
              <span className="shrink-0 font-data text-sm font-semibold text-[var(--umng-navy)]">
                {r.solicitudes} {r.solicitudes === 1 ? 'solicitud' : 'solicitudes'}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-gray-100">
              <div
                className="h-full rounded"
                style={{ width: `${pct}%`, backgroundColor: 'var(--umng-crimson)' }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
