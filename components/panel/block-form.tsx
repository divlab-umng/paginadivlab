'use client'

import { useActionState, useEffect, useRef } from 'react'
import {
  createBlockAction,
  type BlockActionState,
} from '@/app/(laboratorista)/panel/horarios/actions'

// ⚠️ ÚNICO lugar donde vive la convención día→entero.
// Estos values usan ISO (1=lunes … 7=domingo), igual que schedule_blocks.weekday
// y extract(isodow ...) en ensure_sessions.
const DIAS: { value: number; label: string }[] = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
]

const initial: BlockActionState = {}

export function BlockForm({ labId }: { labId: string }) {
  const [state, formAction, pending] = useActionState(createBlockAction, initial)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state.ok) formRef.current?.reset()
  }, [state.ok])

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-6 sm:items-end">
      <input type="hidden" name="lab_id" value={labId} />

      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-xs font-medium text-[var(--umng-ink)]/70">Día</span>
        <select
          name="weekday"
          required
          defaultValue=""
          className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm"
        >
          <option value="" disabled>Selecciona…</option>
          {DIAS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-[var(--umng-ink)]/70">Inicio</span>
        <input
          type="time"
          name="start_time"
          required
          className="w-full rounded-md border border-gray-300 px-2 py-2 font-data text-sm"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-[var(--umng-ink)]/70">Fin</span>
        <input
          type="time"
          name="end_time"
          required
          className="w-full rounded-md border border-gray-300 px-2 py-2 font-data text-sm"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-[var(--umng-ink)]/70">Aforo</span>
        <input
          type="number"
          name="capacity"
          min={1}
          defaultValue={20}
          required
          className="w-full rounded-md border border-gray-300 px-2 py-2 font-data text-sm"
        />
      </label>

      {/* Puestos: mesas o equipos. Vacío = sin límite (como funcionaba antes). */}
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-[var(--umng-ink)]/70">
          Puestos
        </span>
        <input
          type="number"
          name="workstations"
          min={1}
          placeholder="Sin límite"
          title="Mesas o equipos de trabajo. Déjalo vacío si no es una restricción en este laboratorio."
          className="w-full rounded-md border border-gray-300 px-2 py-2 font-data text-sm"
        />
      </label>

      <div className="sm:col-span-6">
        {state.error && (
          <p className="mb-2 text-sm text-[var(--umng-crimson)]">{state.error}</p>
        )}
        {state.ok && (
          <p className="mb-2 text-sm text-[var(--umng-green)]">
            Bloque creado y sesiones generadas.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--umng-crimson)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Creando…' : 'Crear bloque'}
        </button>
      </div>
    </form>
  )
}
