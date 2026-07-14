'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type BlockActionState = { error?: string; ok?: boolean }

export async function createBlockAction(
  _prev: BlockActionState,
  formData: FormData,
): Promise<BlockActionState> {
  const labId = String(formData.get('lab_id') ?? '')
  const weekday = Number(formData.get('weekday'))
  const start = String(formData.get('start_time') ?? '')
  const end = String(formData.get('end_time') ?? '')
  const capacity = Number(formData.get('capacity'))

  if (!labId) return { error: 'Selecciona un laboratorio.' }
  if (Number.isNaN(weekday)) return { error: 'Selecciona un día.' }
  if (!start || !end) return { error: 'Indica hora de inicio y fin.' }
  if (end <= start) return { error: 'La hora de fin debe ser posterior a la de inicio.' }
  if (!Number.isInteger(capacity) || capacity < 1) return { error: 'El aforo debe ser al menos 1.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('create_schedule_block', {
    p_lab_id: labId,
    p_weekday: weekday,
    p_start: start,
    p_end: end,
    p_capacity: capacity,
  })

  if (error) return { error: error.message }

  revalidatePath('/panel/horarios')
  return { ok: true }
}

export async function deactivateBlockAction(
  _prev: BlockActionState,
  formData: FormData,
): Promise<BlockActionState> {
  const blockId = String(formData.get('block_id') ?? '')
  if (!blockId) return { error: 'Bloque inválido.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('deactivate_schedule_block', {
    p_block_id: blockId,
  })
  if (error) return { error: error.message }

  revalidatePath('/panel/horarios')
  return { ok: true }
}
