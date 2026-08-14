// components/panel/group-policy-form.tsx
// Tamaño máximo de grupo de trabajo del laboratorio.
// Vacío o 1 = el lab no admite grupos y cada estudiante reserva individualmente.
'use client'

import { useActionState } from 'react'
import {
  setGroupPolicyAction,
  type BlockActionState,
} from '@/app/(laboratorista)/panel/horarios/actions'

const initial: BlockActionState = {}

export function GroupPolicyForm({
  labId,
  actual,
}: {
  labId: string
  actual: number | null
}) {
  const [state, formAction, pending] = useActionState(setGroupPolicyAction, initial)

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="lab_id" value={labId} />

      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-[var(--umng-ink)]/70">
          Máximo por grupo
        </span>
        <input
          type="number"
          name="max_group_size"
          min={1}
          max={20}
          defaultValue={actual ?? ''}
          placeholder="Sin grupos"
          title="Personas por grupo de trabajo. Vacío o 1 = solo reservas individuales."
          className="w-32 rounded-md border border-gray-300 px-2 py-2 font-data text-sm"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="btn-secondary text-sm disabled:opacity-60"
      >
        {pending ? 'Guardando…' : 'Guardar'}
      </button>

      <p className="basis-full text-xs text-[var(--umng-ink)]/60">
        {actual && actual > 1
          ? `Los estudiantes pueden reservar en grupos de hasta ${actual} personas; el grupo ocupa un solo puesto.`
          : 'Este laboratorio no admite grupos: cada estudiante reserva individualmente.'}
      </p>

      {state.error && (
        <p className="basis-full text-sm text-[var(--umng-crimson)]">{state.error}</p>
      )}
      {state.ok && (
        <p className="basis-full text-sm text-[var(--umng-green)]">Política actualizada.</p>
      )}
    </form>
  )
}
