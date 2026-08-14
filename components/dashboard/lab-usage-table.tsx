// Tabla de uso por laboratorio (capa 2 del dashboard del jefe).
// Server Component puro: recibe las filas de v_lab_usage ya cargadas desde la
// página y las renderiza ordenadas por reservas aprobadas (los más usados
// arriba). La columna "Asistencia" muestra asistencias/registradas, donde
// registradas = asistencias + inasistencias: las reservas aprobadas sin marcar
// (attended = null) NO se cuentan como inasistencia. Si un lab aún no tiene
// ningún registro, muestra "—" en vez de 0 (que se leería como "nadie asistió").


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


export function LabUsageTable({ rows }: { rows: LabUsage[] }) {
  // Ordena por reservas aprobadas desc; a igualdad, por pendientes desc.
  const withActivity = rows.filter(
    (l) =>
      (l.reservas_aprobadas ?? 0) +
        (l.reservas_pendientes ?? 0) +
        (l.reservas_rechazadas ?? 0) +
        (l.reservas_canceladas ?? 0) >
      0,
  )
  const ordered = [...withActivity].sort(
    (a, b) =>
      (b.reservas_aprobadas ?? 0) - (a.reservas_aprobadas ?? 0) ||
      (b.reservas_pendientes ?? 0) - (a.reservas_pendientes ?? 0),
  )


  if (ordered.length === 0) {
    return (
      <p className="text-sm text-[var(--umng-ink)]/60">
        No hay laboratorios con actividad registrada aún.
      </p>
    )
  }


  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left">
            <th className="px-4 py-3 font-semibold text-[var(--umng-ink)]">Laboratorio</th>
            <th className="px-3 py-3 text-right font-semibold text-[var(--umng-ink)]">Aprobadas</th>
            <th className="px-3 py-3 text-right font-semibold text-[var(--umng-ink)]">Pendientes</th>
            <th className="px-3 py-3 text-right font-semibold text-[var(--umng-ink)]">Rechazadas</th>
            <th className="px-3 py-3 text-right font-semibold text-[var(--umng-ink)]">Canceladas</th>
            <th className="px-3 py-3 text-right font-semibold text-[var(--umng-ink)]">Asistencia</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((l) => {
            const registradas = (l.asistencias ?? 0) + (l.inasistencias ?? 0)
            return (
              <tr key={l.lab_id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3">
                  <span className="block font-medium text-[var(--umng-ink)]">{l.name}</span>
                  <span className="block font-data text-xs text-[var(--umng-ink)]/50">{l.code}</span>
                </td>
                <td className="px-3 py-3 text-right font-data text-[var(--umng-green)]">
                  {l.reservas_aprobadas ?? 0}
                </td>
                <td className="px-3 py-3 text-right font-data text-[var(--umng-ink)]/80">
                  {l.reservas_pendientes ?? 0}
                </td>
                <td className="px-3 py-3 text-right font-data text-[var(--umng-ink)]/80">
                  {l.reservas_rechazadas ?? 0}
                </td>
                <td className="px-3 py-3 text-right font-data text-[var(--umng-ink)]/80">
                  {l.reservas_canceladas ?? 0}
                </td>
                <td
                  className="px-3 py-3 text-right font-data text-[var(--umng-ink)]/80"
                  title={
                    registradas > 0
                      ? `${l.asistencias ?? 0} asistieron, ${l.inasistencias ?? 0} no asistieron`
                      : 'Sin asistencia registrada'
                  }
                >
                  {registradas > 0 ? `${l.asistencias ?? 0}/${registradas}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
