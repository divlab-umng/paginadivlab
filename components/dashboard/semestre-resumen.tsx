// components/dashboard/semestre-resumen.tsx — histórico de prácticas por semestre
// Convención colombiana: I = enero–junio, II = julio–diciembre.

export type SemestreRow = {
  semestre: string;
  solicitudes: number;
  aprobadas: number;
  pendientes: number;
  rechazadas: number;
  canceladas: number;
  asistencias: number;
  inasistencias: number;
  estudiantes: number;
  laboratorios: number;
  horas_aprobadas: number;
};

/** "2026-II" → "2026 · II semestre" */
export function rotuloSemestre(s: string) {
  const [anio, periodo] = s.split("-");
  return `${anio} · ${periodo} semestre`;
}

export function SemestreResumen({ rows }: { rows: SemestreRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-[var(--umng-ink)]/60">
        Todavía no hay prácticas registradas.
      </p>
    );
  }

  const maxSolicitudes = Math.max(...rows.map((r) => r.solicitudes), 1);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-[var(--umng-ink)]/60">
            <th className="px-4 py-3 font-medium">Semestre</th>
            <th className="px-4 py-3 font-medium">Solicitadas</th>
            <th className="px-4 py-3 text-right font-medium">Aprobadas</th>
            <th className="px-4 py-3 text-right font-medium">Rechazadas</th>
            <th className="px-4 py-3 text-right font-medium">Canceladas</th>
            <th className="px-4 py-3 text-right font-medium">Asistencias</th>
            <th className="px-4 py-3 text-right font-medium">Horas</th>
            <th className="px-4 py-3 text-right font-medium">Estudiantes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.semestre} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-3 font-medium text-[var(--umng-navy)]">
                {rotuloSemestre(r.semestre)}
              </td>
              {/* Barra proporcional: compara semestres de un vistazo */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-data font-bold text-[var(--umng-ink)]">
                    {r.solicitudes}
                  </span>
                  <span
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.round((r.solicitudes / maxSolicitudes) * 100)}%`,
                      minWidth: 6,
                      maxWidth: 140,
                      backgroundColor: "var(--umng-sky)",
                    }}
                  />
                </div>
              </td>
              <td className="px-4 py-3 text-right font-data text-[var(--umng-green)]">
                {r.aprobadas}
              </td>
              <td className="px-4 py-3 text-right font-data text-[var(--umng-ink)]/60">
                {r.rechazadas}
              </td>
              <td className="px-4 py-3 text-right font-data text-[var(--umng-ink)]/60">
                {r.canceladas}
              </td>
              <td className="px-4 py-3 text-right font-data">{r.asistencias}</td>
              <td className="px-4 py-3 text-right font-data">
                {Number(r.horas_aprobadas).toFixed(1)}
              </td>
              <td className="px-4 py-3 text-right font-data">{r.estudiantes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
