// app/(laboratorista)/panel/actions.ts — Server Action: decidir solicitudes (laboratorista)
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type DecideResult =
  | { ok: true; approved: boolean }
  | { ok: false; error: string };

export async function decideReservation(
  reservationId: string,
  approve: boolean,
  reason?: string
): Promise<DecideResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("decide_reservation", {
    p_reservation_id: reservationId,
    p_approve: approve,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });

  if (error) {
    // El RPC lanza mensajes en español legibles (permisos, estado inválido…).
    return { ok: false, error: error.message || "No se pudo procesar la decisión." };
  }

  revalidatePath("/panel");
  return { ok: true, approved: approve };
}
