// app/(estudiante)/mis-reservas/actions.ts — Server Action para cancelar reservas
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CancelResult = { ok: true } | { ok: false; error: string };

export async function cancelReservation(
  reservationId: string
): Promise<CancelResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_reservation", {
    p_reservation_id: reservationId,
  });

  if (error) {
    // El RPC lanza mensajes en español legibles (dueño, estado inválido…).
    return { ok: false, error: error.message || "No se pudo cancelar la reserva." };
  }

  revalidatePath("/mis-reservas");
  revalidatePath("/laboratorios");
  return { ok: true };
}
