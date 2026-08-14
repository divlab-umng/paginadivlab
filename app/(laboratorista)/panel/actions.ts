// app/(laboratorista)/panel/actions.ts — Server Actions del panel (laboratorista)
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/email/resend";
import {
  correoPracticaAprobada,
  correoSolicitudRechazada,
} from "@/lib/email/templates";

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

  // ── Correo al estudiante: en AMBAS decisiones ───────────────────────────
  //
  // Al crear la solicitud no se le escribe (eso solo avisa al laboratorista),
  // pero sí se le informa el desenlace. Sin el correo de rechazo quedaría
  // esperando indefinidamente una aprobación que nunca llega, y perdería la
  // oportunidad de buscar otra franja a tiempo.
  //
  // Best-effort: si el correo falla, la decisión ya quedó firme en la base.
  try {
    const { data: res } = await supabase
      .from("reservations")
      .select(
        `student_name, student_email, student_code, group_id,
         students ( full_name, email, student_code ),
         subjects ( name ),
         block_sessions!inner (
           session_date, start_time, end_time,
           laboratories!inner ( name, safety_notes )
         )`
      )
      .eq("id", reservationId)
      .single();

    if (res) {
      const canon = res.students as unknown as {
        full_name: string | null;
        email: string | null;
        student_code: string | null;
      } | null;

      const destino = canon?.email ?? (res.student_email as string | null);
      const nombre =
        canon?.full_name ?? (res.student_name as string | null) ?? "estudiante";
      const codigo =
        canon?.student_code ?? (res.student_code as string | null) ?? "";

      if (destino) {
        const s = res.block_sessions as unknown as {
          session_date: string;
          start_time: string;
          end_time: string;
          laboratories: { name: string; safety_notes: string | null };
        };
        const materia =
          (res.subjects as unknown as { name: string } | null)?.name ?? null;
        const franja = {
          labName: s.laboratories.name,
          sessionDate: s.session_date,
          startTime: s.start_time,
          endTime: s.end_time,
        };

        let asunto: string;
        let html: string;

        if (approve) {
          // Si la práctica es en grupo, se listan los compañeros para que el
          // estudiante sepa con quién comparte el puesto de trabajo.
          let companeros: string[] = [];
          if (res.group_id) {
            const { data: equipo } = await supabase
              .from("reservations")
              .select("student_name, students ( full_name )")
              .eq("group_id", res.group_id as string)
              .neq("id", reservationId);

            companeros = (equipo ?? [])
              .map(
                (m) =>
                  (m.students as unknown as { full_name: string | null } | null)
                    ?.full_name ?? (m.student_name as string | null)
              )
              .filter((n): n is string => Boolean(n));
          }

          ({ asunto, html } = correoPracticaAprobada({
            nombre,
            codigo,
            materia,
            franja,
            companeros,
            // Instrucciones propias del laboratorio; si están vacías, la
            // plantilla usa las genéricas.
            instrucciones: s.laboratories.safety_notes,
          }));
        } else {
          ({ asunto, html } = correoSolicitudRechazada({
            nombre,
            materia,
            franja,
            motivo: reason?.trim() || null,
          }));
        }

        await enviarCorreo({ para: destino, asunto, html });
      }
    }
  } catch (e) {
    console.error(
      "[panel] no se pudo enviar el correo de decisión:",
      (e as Error).message
    );
  }

  revalidatePath("/panel");
  return { ok: true, approved: approve };
}

export type ScanResult = {
  ok: boolean;
  motivo: "marcado" | "ya_marcado" | "sin_reserva" | "error";
  nombre?: string | null;
  codigo: string;
  mensaje?: string;
};

/**
 * Registra la asistencia de UN estudiante a partir del código escaneado del carné.
 * Persiste al instante (no se acumula en el navegador): si el celular se apaga
 * a mitad de la práctica, lo ya escaneado queda guardado.
 */
export async function scanAttendance(
  sessionId: string,
  studentCode: string
): Promise<ScanResult> {
  const codigo = studentCode.replace(/\D/g, "");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("mark_attendance_by_code", {
    p_session_id: sessionId,
    p_student_code: codigo,
  });

  if (error) {
    return {
      ok: false,
      motivo: "error",
      codigo,
      mensaje: error.message || "No se pudo registrar.",
    };
  }

  // Forma real de la fila del RPC (ojo: la columna es full_name, no nombre).
  type FilaRpc = {
    ok: boolean;
    motivo: ScanResult["motivo"];
    reservation_id: string | null;
    full_name: string | null;
    student_code: string | null;
  };

  const fila = (data as FilaRpc[] | null)?.[0];
  if (!fila) {
    return { ok: false, motivo: "error", codigo, mensaje: "Respuesta vacía." };
  }

  revalidatePath("/panel");
  return {
    ok: fila.ok,
    motivo: fila.motivo,
    nombre: fila.full_name,
    codigo: fila.student_code ?? codigo,
  };
}

export type MarkAttendanceResult =
  | { ok: true; marcadas: number }
  | { ok: false; error: string };

/**
 * Registra la asistencia de una sesión completa.
 * absentReservationIds = ids de RESERVACIÓN que estuvieron ausentes.
 * El RPC marca a todos los aprobados como presentes salvo los de esa lista.
 */
export async function markAttendance(
  sessionId: string,
  absentReservationIds: string[]
): Promise<MarkAttendanceResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("mark_session_attendance", {
    p_session_id: sessionId,
    p_absent_ids: absentReservationIds ?? [],
  });

  if (error) {
    // El RPC valida autorización y que la sesión ya terminó, con mensajes en español.
    return { ok: false, error: error.message || "No se pudo registrar la asistencia." };
  }

  revalidatePath("/panel");
  return { ok: true, marcadas: (data as number) ?? 0 };
}
