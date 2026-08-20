// components/dashboard/grafica-demanda.tsx
// Barras horizontales: qué laboratorios concentran la demanda.
//
// POR QUÉ BARRAS HORIZONTALES Y NO VERTICALES
//   Los nombres son largos ("LABORATORIO DISEÑO Y SIMULACIÓN DE EXPERIMENTOS").
//   En vertical habría que rotarlos o cortarlos; en horizontal se leen de
//   corrido y la comparación entre laboratorios sigue siendo inmediata.
//
// POR QUÉ NO HAY CONSULTA NUEVA
//   Se alimenta de `v_lab_usage`, que el dashboard ya carga para la tabla de
//   uso. Pasar los mismos datos a otro componente no cuesta nada; volver a
//   consultarlos habría añadido una ida y vuelta a la base por cada visita.
//
// COMPONENTE DE SERVIDOR: sin 'use client'. Llega como HTML, sin JavaScript.

export type DemandaLab = {
  lab_id: string
  name: string
  aprobadas: number
  pendientes: number
  total: number
}

/** Cuántos laboratorios se muestran. Más allá, la gráfica se vuelve ilegible. */
const TOPE = 8

export function GraficaDemanda({ labs }: { labs: DemandaLab[] }) {
  const conDatos = labs
    .filter((l) => l.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, TOPE)

  if (conDatos.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-4 font-display text-base font-semibold text-[var(--umng-navy)]">
          Laboratorios con más demanda
        </h3>
        <p className="py-10 text-center text-sm text-[var(--umng-ink)]/50">
          Todavía no hay reservas para comparar.
        </p>
      </div>
    )
  }

  // La barra más larga marca el 100% del ancho: la gráfica compara entre
  // laboratorios, no contra un máximo teórico que no existe.
  const mayor = conDatos[0].total

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-[var(--umng-navy)]">
          Laboratorios con más demanda
        </h3>
        <span className="font-data text-xs text-[var(--umng-ink)]/50">
          {conDatos.length === TOPE ? `top ${TOPE}` : `${conDatos.length} labs`}
        </span>
      </div>

      <ul className="space-y-3">
        {conDatos.map((l) => {
          const pct = Math.round((l.total / mayor) * 100)
          // Dentro de cada barra se distingue lo aprobado de lo pendiente: un
          // laboratorio con mucha demanda pero todo sin resolver es un problema
          // distinto a uno con mucha demanda ya atendida.
          const pctAprob = l.total > 0 ? (l.aprobadas / l.total) * 100 : 0

          return (
            <li key={l.lab_id}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-[var(--umng-ink)]/85">
                  {tituloLimpio(l.name)}
                </span>
                <span className="shrink-0 font-data text-sm font-semibold text-[var(--umng-ink)]">
                  {l.total}
                </span>
              </div>

              <div
                className="h-3 w-full overflow-hidden rounded-full bg-[var(--umng-surface,#f1f5f9)]"
                role="img"
                aria-label={`${tituloLimpio(l.name)}: ${l.total} reservas, ${l.aprobadas} aprobadas`}
              >
                <div className="h-full rounded-full" style={{ width: `${pct}%` }}>
                  <div className="flex h-full w-full">
                    <div
                      style={{
                        width: `${pctAprob}%`,
                        backgroundColor: 'var(--umng-green)',
                      }}
                    />
                    <div
                      style={{
                        width: `${100 - pctAprob}%`,
                        backgroundColor: 'var(--umng-gold)',
                      }}
                    />
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex items-center gap-4 border-t border-gray-100 pt-3 text-xs text-[var(--umng-ink)]/60">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: 'var(--umng-green)' }}
            aria-hidden
          />
          Aprobadas
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: 'var(--umng-gold)' }}
            aria-hidden
          />
          Resto (pendientes, rechazadas, canceladas)
        </span>
      </div>
    </div>
  )
}

/** "LABORATORIO METALES" → "Metales". Los nombres vienen en mayúsculas del catálogo. */
function tituloLimpio(nombre: string): string {
  const sinPrefijo = nombre.replace(/^LABORATORIO\s+/i, '').trim()
  return sinPrefijo
    .toLocaleLowerCase('es')
    .replace(/(^|\s|\()([a-záéíóúñ])/g, (_m, sep, letra) => sep + letra.toLocaleUpperCase('es'))
}
