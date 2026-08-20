// components/dashboard/grafica-estados.tsx
// Dona con el balance de solicitudes por estado.
//
// SVG A MANO, SIN LIBRERÍA DE GRÁFICAS
//   El proyecto no tiene Chart.js ni Recharts, y traer una entera para dibujar
//   un anillo de cuatro tramos costaría más de lo que resuelve: son ~150 KB de
//   JavaScript que el navegador tendría que descargar y ejecutar. Un `circle`
//   con `stroke-dasharray` hace exactamente lo mismo con cero dependencias.
//
//   El truco: la circunferencia vale 2πr. Si se pinta un trazo de longitud
//   `porcentaje × circunferencia` y se deja el resto en blanco, queda el arco.
//   Encadenando arcos con `stroke-dashoffset` se arma la dona completa.
//
// COMPONENTE DE SERVIDOR: no lleva 'use client'. Se renderiza en el servidor y
// llega como HTML puro, sin un solo byte de JavaScript al navegador.
import type { ReactNode } from 'react'

export type EstadoReservas = {
  aprobadas: number
  pendientes: number
  rechazadas: number
  canceladas: number
}

const R = 70          // radio de la línea media del anillo
const GROSOR = 26     // ancho del anillo
const LADO = 180      // lado del viewBox cuadrado
const C = 2 * Math.PI * R

type Tramo = {
  clave: string
  etiqueta: string
  valor: number
  color: string
}

export function GraficaEstados({ datos }: { datos: EstadoReservas }) {
  const tramos: Tramo[] = [
    { clave: 'apr', etiqueta: 'Aprobadas',  valor: datos.aprobadas,  color: 'var(--umng-green)' },
    { clave: 'pen', etiqueta: 'Pendientes', valor: datos.pendientes, color: 'var(--umng-gold)' },
    { clave: 'rec', etiqueta: 'Rechazadas', valor: datos.rechazadas, color: 'var(--umng-crimson)' },
    { clave: 'can', etiqueta: 'Canceladas', valor: datos.canceladas, color: '#94a3b8' },
  ]

  const total = tramos.reduce((acc, t) => acc + t.valor, 0)

  if (total === 0) {
    return (
      <Marco titulo="Estado de las solicitudes">
        <p className="py-10 text-center text-sm text-[var(--umng-ink)]/50">
          Todavía no hay solicitudes registradas.
        </p>
      </Marco>
    )
  }

  // Se acumula el desplazamiento para que cada arco empiece donde terminó el
  // anterior. El signo negativo es porque stroke-dashoffset avanza al revés.
  let acumulado = 0
  const arcos = tramos
    .filter((t) => t.valor > 0)
    .map((t) => {
      const largo = (t.valor / total) * C
      const arco = { ...t, largo, offset: -acumulado }
      acumulado += largo
      return arco
    })

  return (
    <Marco titulo="Estado de las solicitudes">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
        <div className="relative shrink-0">
          <svg
            viewBox={`0 0 ${LADO} ${LADO}`}
            className="h-44 w-44"
            role="img"
            aria-label={`Dona: ${tramos
              .filter((t) => t.valor > 0)
              .map((t) => `${t.etiqueta} ${t.valor}`)
              .join(', ')}`}
          >
            {/* Se gira -90° para que el primer tramo arranque arriba y no a la
                derecha, que es donde SVG empieza a dibujar por defecto. */}
            <g transform={`rotate(-90 ${LADO / 2} ${LADO / 2})`}>
              <circle
                cx={LADO / 2}
                cy={LADO / 2}
                r={R}
                fill="none"
                stroke="var(--umng-surface, #f1f5f9)"
                strokeWidth={GROSOR}
              />
              {arcos.map((a) => (
                <circle
                  key={a.clave}
                  cx={LADO / 2}
                  cy={LADO / 2}
                  r={R}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={GROSOR}
                  strokeDasharray={`${a.largo} ${C - a.largo}`}
                  strokeDashoffset={a.offset}
                />
              ))}
            </g>
          </svg>

          {/* El total va en el centro del anillo, no en la leyenda: es el dato
              que se busca primero al mirar una dona. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-data text-2xl font-bold text-[var(--umng-ink)]">
              {total}
            </span>
            <span className="text-xs text-[var(--umng-ink)]/60">solicitudes</span>
          </div>
        </div>

        <ul className="w-full space-y-2">
          {tramos.map((t) => {
            const pct = total > 0 ? Math.round((t.valor / total) * 100) : 0
            return (
              <li key={t.clave} className="flex items-center gap-3 text-sm">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: t.color }}
                  aria-hidden
                />
                <span className="flex-1 text-[var(--umng-ink)]/80">{t.etiqueta}</span>
                <span className="font-data font-semibold text-[var(--umng-ink)]">
                  {t.valor}
                </span>
                <span className="w-10 text-right font-data text-xs text-[var(--umng-ink)]/50">
                  {pct}%
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </Marco>
  )
}

function Marco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-4 font-display text-base font-semibold text-[var(--umng-navy)]">
        {titulo}
      </h3>
      {children}
    </div>
  )
}
