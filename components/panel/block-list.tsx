'use client'

import { useActionState, useState } from 'react'
import {
  deactivateBlockAction,
  type BlockActionState,
} from '@/app/(laboratorista)/panel/horarios/actions'

const DIA_LABEL: Record<number, string> = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles',
  4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo',
}

type Block = {
  id: string
  lab_id: string
  weekday: number
  start_time: string
  end_time: string
  capacity: number
}

const hhmm = (t: string) => (t ? t.slice(0, 5) : t)
const initial: BlockActionState = {}

export function BlockList({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) {
    return <p className="text-sm text-[var(--umng-ink)]/60">Sin bloques configurados aún.</p>
  }
  return (
    <ul className="divide-y divide-gray-100">
      {blocks.map((b) => (
        <BlockRow key={b.id} block={b} />
      ))}
    </ul>
  )
}

function BlockRow({ block }: { block: Block }) {
  const [confirming, setConfirming] = useState(false)
  const [state, formAction, pending] = useActionState(deactivateBlockAction, initial)

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="flex items-center gap-3 text-sm">
        <span className="w-24 font-medium text-[var(--umng-ink)]">
          {DIA_LABEL[block.weekday] ?? '—'}
        </span>
        <span className="font-data text-[var(--umng-ink)]/80">
          {hhmm(block.start_time)}–{hhmm(block.end_time)}
        </span>
        <span className="font-data text-xs text-[var(--umng-ink)]/60">
          aforo {block.capacity}
        </span>
      </div>

      {confirming ? (
        <form action={formAction} className="flex items-center gap-3">
          <input type="hidden" name="block_id" value={block.id} />
          <button
            type="submit"
            disabled={pending}
            className="text-xs font-semibold text-[var(--umng-crimson)] disabled:opacity-60"
          >
            {pending ? 'Eliminando…' : 'Confirmar'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs text-[var(--umng-ink)]/60"
          >
            Cancelar
          </button>
        </form>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="text-xs text-[var(--umng-ink)]/60 hover:text-[var(--umng-crimson)]"
        >
          Eliminar
        </button>
      )}

      {state.error && (
        <span className="w-full text-xs text-[var(--umng-crimson)]">{state.error}</span>
      )}
    </li>
  )
}
