// app/(publico)/consulta/actions.ts — seguimiento de reservas SIN cuenta.
// El estudiante se identifica con su código de carné + correo institucional:
// ambos datos son obligatorios, para que un solo dato no permita listar reservas.
"use server";

import { createClient } from "@/lib/supabase/server";

export type ReservaConsulta = {
  reservation_id: string;
  status: "pendiente" | "aprobada" | "rechazada" | "cancelada";
  lab_code: string;
  lab_name: string;
  subject_name: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  created_at: string;
  /** null si la reserva es individual */
  group_id: string | null;
  /** true si esta persona creó el grupo (solo ella puede cancelarlo completo) */
  es_lider: boolean;
  /** integrantes activos del grupo; 1 si es individual */
  integrantes: number;
};

export type ConsultaResult =
  | { ok: true; reservas: ReservaConsulta[] }
  | { ok: false; error: string };

export async function consultarReservas(
  code: string,
  email: string
): Promise<ConsultaResult> {
  const codigo = code.replace(/\D/g, "");
  const correo = email.trim().toLowerCase();

  if (!/^[0-9]{4,15}$/.test(codigo)) {
    return { ok: false, error: "El código debe ser numérico (4 a 15 dígitos)." };
  }
  if (!/^[a-zA-Z0-9._%+-]+@unimilitar\.edu\.co$/.test(correo)) {
    return { ok: false, error: "Usa tu correo institucional @unimilitar.edu.co." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lookup_reservations_public", {
    p_student_code: codigo,
    p_student_email: correo,
  });

  if (error) {
    return { ok: false, error: error.message || "No se pudo consultar." };
  }
  return { ok: true, reservas: (data ?? []) as ReservaConsulta[] };
}

export type CancelarResult = { ok: true } | { ok: false; error: string };

export async function cancelarReserva(
  reservationId: string,
  code: string,
  email: string
): Promise<CancelarResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_reservation_public", {
    p_reservation_id: reservationId,
    p_student_code: code.replace(/\D/g, ""),
    p_student_email: email.trim().toLowerCase(),
  });

  if (error) {
    // El RPC valida que los datos coincidan y que el estado permita cancelar.
    return { ok: false, error: error.message || "No se pudo cancelar la reserva." };
  }
  return { ok: true };
}

/**
 * Cancela TODO el grupo de trabajo de una vez.
 * El RPC exige ser quien creó el grupo: que un integrante cualquiera borre la
 * práctica de sus compañeros sería destructivo e imposible de deshacer.
 */
export async function cancelarGrupo(
  reservationId: string,
  code: string,
  email: string
): Promise<CancelarResult> {
  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_group_reservation_public", {
    p_reservation_id: reservationId,
    p_student_code: code.replace(/\D/g, ""),
    p_student_email: email.trim().toLowerCase(),
  });

  if (error) {
    return { ok: false, error: error.message || "No se pudo cancelar el grupo." };
  }
  return { ok: true };
}
