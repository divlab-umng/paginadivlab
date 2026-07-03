// app/(estudiante)/laboratorios/actions.ts — Server Actions de reserva (estudiante)
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type RequestResult = { ok: true } | { ok: false; error: string };

// labCode se pre-liga en la página con .bind(); sessionId lo pasa el botón.
export async function requestReservation(
  labCode: string,
  sessionId: string
): Promise<RequestResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("request_reservation", {
    p_session_id: sessionId,
  });

  if (error) {
    // El RPC ya lanza mensajes en español legibles (aforo, rol, duplicado…).
    return { ok: false, error: error.message || "No se pudo solicitar la reserva." };
  }

  // Refresca el cupo mostrado en el detalle y en la lista.
  revalidatePath(`/laboratorios/${labCode}`);
  revalidatePath("/laboratorios");
  return { ok: true };
}
