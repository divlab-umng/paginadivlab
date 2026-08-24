// app/(laboratorista)/panel/walk-in-actions.ts
// Entrada inmediata: el estudiante que llega sin haber reservado.
//
// TODA LA LÓGICA VIVE EN EL RPC, NO AQUÍ. Estas acciones solo traducen entre el
// formulario y `register_walk_in_attendance`. El aforo, el bloqueo pesimista y
// la decisión de qué sesión usar se resuelven dentro de Postgres, en una sola
// transacción: replicarlo en TypeScript abriría una ventana entre "consulté el
// cupo" y "escribí la reserva" por la que se cuelan dos personas en el último
// puesto.
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { POLITICA_VERSION } from "@/lib/politica-datos";

export type EstudianteConocido = {
  student_id: string;
  student_code: string;
  full_name: string | null;
  email: string | null;
};

export type WalkInState = {
  error?: string;
  ok?: boolean;
  mensaje?: string;
  cuposRestantes?: number;
  esComodin?: boolean;
  yaTeniaReserva?: boolean;
  /**
   * Marca única de cada registro exitoso.
   *
   * Sin ella, dos entradas seguidas con el mismo resultado producirían un
   * estado idéntico y el formulario no sabría que hubo un segundo registro que
   * también hay que limpiar. Con el nonce, cada éxito es distinguible.
   */
  nonce?: number;
};

/** Solo dígitos: Code 39 trae los delimitadores `*` y algunos lectores añaden espacios. */
function soloDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/**
 * Autocompletado por código de carné.
 * Que el laboratorista no reescriba a alguien que ya vino: si teclea el nombre
 * distinto, `upsert_student` lo actualiza y se pierde consistencia histórica.
 */
export async function buscarEstudiante(
  codigo: string
): Promise<EstudianteConocido | null> {
  const code = soloDigitos(codigo);
  if (code.length === 0) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lookup_student_by_code", {
    p_student_code: code,
  });

  if (error) return null;
  const filas = (data ?? []) as EstudianteConocido[];
  return filas[0] ?? null;
}

export async function registrarWalkInAction(
  _prev: WalkInState,
  formData: FormData
): Promise<WalkInState> {
  const labCode = String(formData.get("lab_code") ?? "").trim();
  const codigo = soloDigitos(String(formData.get("student_code") ?? ""));
  const nombre = String(formData.get("student_name") ?? "").trim();
  const correo = String(formData.get("student_email") ?? "").trim().toLowerCase();
  const subjectId = String(formData.get("subject_id") ?? "").trim();
  const programId = String(formData.get("program_id") ?? "").trim();

  if (!labCode) return { error: "Selecciona el laboratorio." };
  if (!codigo) return { error: "Falta el código del estudiante." };

  // Validación mínima en el cliente para no gastar una ida al servidor. La
  // definitiva la hace el RPC, que es quien puede negarse por aforo.
  if (nombre && nombre.length < 3) {
    return { error: "El nombre es demasiado corto." };
  }
  if (correo && !/^[^\s@]+@unimilitar\.edu\.co$/i.test(correo)) {
    return { error: "El correo debe ser institucional (@unimilitar.edu.co)." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_walk_in_attendance", {
    p_lab_code: labCode,
    p_student_code: codigo,
    p_student_name: nombre || null,
    p_student_email: correo || null,
    p_subject_id: subjectId || null,
    p_program_id: programId || null,
    // Un walk-in también trata datos personales. Se guarda la versión de la
    // política vigente para que la autorización quede fechada y trazable.
    p_consent_version: POLITICA_VERSION,
  });

  if (error) {
    // Los mensajes del RPC (aforo lleno, sin puestos, estudiante desconocido)
    // están escritos para leerse tal cual: no se reescriben aquí.
    return { error: error.message };
  }

  const fila = (data ?? [])[0] as
    | {
        es_comodin: boolean;
        ya_tenia_reserva: boolean;
        cupos_restantes: number;
        inicio: string;
        fin: string;
      }
    | undefined;

  revalidatePath("/panel");

  if (!fila) {
    return { ok: true, mensaje: "Entrada registrada.", nonce: Date.now() };
  }

  const franja = `${fila.inicio?.slice(0, 5)}–${fila.fin?.slice(0, 5)}`;
  const mensaje = fila.ya_tenia_reserva
    ? `Ya tenía reserva en esta sesión (${franja}). Se marcó su asistencia.`
    : fila.es_comodin
      ? `Entrada registrada en práctica libre (${franja}).`
      : `Entrada registrada en la sesión de ${franja}.`;

  return {
    ok: true,
    mensaje,
    cuposRestantes: fila.cupos_restantes,
    esComodin: fila.es_comodin,
    yaTeniaReserva: fila.ya_tenia_reserva,
    nonce: Date.now(),
  };
}
