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
  // Puestos de trabajo: vacío = sin límite (comportamiento histórico).
  const rawPuestos = String(formData.get('workstations') ?? '').trim()
  const workstations = rawPuestos === '' ? null : Number(rawPuestos)

  if (!labId) return { error: 'Selecciona un laboratorio.' }
  if (Number.isNaN(weekday)) return { error: 'Selecciona un día.' }
  if (!start || !end) return { error: 'Indica hora de inicio y fin.' }
  if (end <= start) return { error: 'La hora de fin debe ser posterior a la de inicio.' }
  if (!Number.isInteger(capacity) || capacity < 1) return { error: 'El aforo debe ser al menos 1.' }
  if (workstations !== null) {
    if (!Number.isInteger(workstations) || workstations < 1) {
      return { error: 'Los puestos deben ser al menos 1, o déjalo vacío.' }
    }
    if (workstations > capacity) {
      return { error: 'No puede haber más puestos que aforo.' }
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('create_schedule_block', {
    p_lab_id: labId,
    p_weekday: weekday,
    p_start: start,
    p_end: end,
    p_capacity: capacity,
    p_workstations: workstations,
  })

  if (error) return { error: error.message }

  revalidatePath('/panel/horarios')
  return { ok: true }
}

/**
 * Instrucciones de ingreso propias del laboratorio.
 * Se envían al estudiante en el correo de aprobación, una viñeta por línea.
 * Vacío = el correo usa las instrucciones genéricas.
 */
export async function setSafetyNotesAction(
  _prev: BlockActionState,
  formData: FormData,
): Promise<BlockActionState> {
  const labId = String(formData.get('lab_id') ?? '')
  const notas = String(formData.get('safety_notes') ?? '')

  if (!labId) return { error: 'Laboratorio inválido.' }
  if (notas.length > 2000) {
    return { error: 'Las instrucciones no pueden superar 2000 caracteres.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_lab_safety_notes', {
    p_lab_id: labId,
    p_notes: notas,
  })
  if (error) return { error: error.message }

  revalidatePath('/panel/horarios')
  return { ok: true }
}

/** Tamaño máximo de grupo del laboratorio. Vacío o 1 = no admite grupos. */
export async function setGroupPolicyAction(
  _prev: BlockActionState,
  formData: FormData,
): Promise<BlockActionState> {
  const labId = String(formData.get('lab_id') ?? '')
  const raw = String(formData.get('max_group_size') ?? '').trim()
  const max = raw === '' ? null : Number(raw)

  if (!labId) return { error: 'Laboratorio inválido.' }
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 20)) {
    return { error: 'El tamaño de grupo debe estar entre 1 y 20, o vacío.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('set_lab_group_policy', {
    p_lab_id: labId,
    p_max_group_size: max,
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
