// app/(publico)/entrada/[lab]/actions.ts
// El estudiante que llega sin reserva se anuncia desde su propio celular.
//
// LO QUE ESTA ACCIÓN NO HACE: marcar asistencia. Crea una solicitud
// 'pendiente'; la presencia la certifica el laboratorista escaneando el carné.
// Toda la lógica —sesión en curso, aforo, duplicados— vive en el RPC.
"use server";

import { createClient } from "@/lib/supabase/server";
import { POLITICA_VERSION } from "@/lib/politica-datos";

export type EntradaState = {
  error?: string;
  ok?: boolean;
  labName?: string;
  franja?: string;
  yaAnunciado?: boolean;
};

export async function anunciarEntradaAction(
  _prev: EntradaState,
  formData: FormData
): Promise<EntradaState> {
  const labCode = String(formData.get("lab_code") ?? "").trim();
  const codigo = String(formData.get("student_code") ?? "").replace(/\D/g, "");
  const nombre = String(formData.get("student_name") ?? "").trim();
  const correo = String(formData.get("student_email") ?? "").trim().toLowerCase();
  const subjectId = String(formData.get("subject_id") ?? "").trim();
  const programId = String(formData.get("program_id") ?? "").trim();
  const autoriza = formData.get("autoriza") === "on";

  if (!autoriza) {
    return { error: "Debes autorizar el tratamiento de tus datos personales." };
  }
  if (!codigo) return { error: "Escribe el código de tu carné." };
  if (nombre.length < 3) return { error: "Escribe tu nombre completo." };
  if (!/^[^\s@]+@unimilitar\.edu\.co$/i.test(correo)) {
    return { error: "Usa tu correo institucional @unimilitar.edu.co." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_walk_in_public", {
    p_lab_code: labCode,
    p_student_code: codigo,
    p_student_name: nombre,
    p_student_email: correo,
    p_subject_id: subjectId || null,
    p_program_id: programId || null,
    p_consent_version: POLITICA_VERSION,
  });

  // Los mensajes del RPC están escritos para que el estudiante los entienda
  // ("El laboratorio está lleno en este momento…"): no se reescriben aquí.
  if (error) return { error: error.message };

  const fila = (data ?? [])[0] as
    | { ya_anunciado: boolean; lab_name: string; inicio: string; fin: string }
    | undefined;

  return {
    ok: true,
    labName: fila?.lab_name,
    franja: fila ? `${fila.inicio?.slice(0, 5)}–${fila.fin?.slice(0, 5)}` : undefined,
    yaAnunciado: fila?.ya_anunciado ?? false,
  };
}
