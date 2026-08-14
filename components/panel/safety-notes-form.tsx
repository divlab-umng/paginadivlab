// components/panel/safety-notes-form.tsx
// Instrucciones de ingreso propias del laboratorio.
//
// Van dentro del correo de aprobación que recibe el estudiante. Quien sabe qué
// advertir es el laboratorista —no es lo mismo entrar a Metales que a CIM—, así
// que el texto se edita aquí y no está escrito en el código.
'use client'

import { useActionState } from 'react'
import {
  setSafetyNotesAction,
  type BlockActionState,
} from '@/app/(laboratorista)/panel/horarios/actions'

const initial: BlockActionState = {}

const EJEMPLO = `Usa gafas de seguridad durante toda la práctica.
No ingreses con anillos, pulseras ni manga suelta cerca de las máquinas.
Recoge el cabello largo antes de operar el torno.
Reporta cualquier falla del equipo al laboratorista, no la manipules.`

export function SafetyNotesForm({
  labId,
  actual,
}: {
  labId: string
  actual: string | null
}) {
  const [state, formAction, pending] = useActionState(setSafetyNotesAction, initial)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="lab_id" value={labId} />

      <p className="text-xs text-[var(--umng-ink)]/60">
        Escribe <strong>una instrucción por línea</strong>. Aparecerán como lista
        en el correo que recibe el estudiante al aprobarle la práctica. Si lo
        dejas vacío, se envían las instrucciones generales.
      </p>

      <textarea
        name="safety_notes"
        rows={5}
        maxLength={2000}
        defaultValue={actual ?? ''}
        placeholder={EJEMPLO}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed"
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn-secondary text-sm disabled:opacity-60"
        >
          {pending ? 'Guardando…' : 'Guardar instrucciones'}
        </button>

        <span className="text-xs text-[var(--umng-ink)]/50">
          {actual
            ? 'Este laboratorio usa instrucciones propias.'
            : 'Actualmente se envían las instrucciones generales.'}
        </span>
      </div>

      {state.error && (
        <p className="text-sm text-[var(--umng-crimson)]">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-sm text-[var(--umng-green)]">Instrucciones actualizadas.</p>
      )}
    </form>
  )
}
