// app/(publico)/reservar/actions.ts — Server Action del flujo público (sin login)
"use server";

import { createClient } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/email/resend";
import { correoNuevaSolicitud } from "@/lib/email/templates";
import { POLITICA_VERSION } from "@/lib/politica-datos";

export type Integrante = { nombre: string; correo: string; codigo: string };

export type Subject = { id: string; code: string; name: string };
export type Lab = { code: string; name: string };

/** Oferta de UNA carrera: sus materias y, por materia, dónde se dictan. */
export type OfertaCarrera = {
  subjects: Subject[];
  labsBySubject: Record<string, Lab[]>;
};

/**
 * Carga la oferta de una carrera en una sola llamada.
 *
 * POR QUÉ NO SE CARGA TODO EL CATÁLOGO DE ENTRADA
 *   La versión anterior traía todas las materias y todos los mapeos al abrir
 *   la página. Con tres laboratorios eso eran unas decenas de filas; con los
 *   cincuenta previstos serían cientos viajando al celular de cada estudiante
 *   para mostrar únicamente las de su carrera.
 *
 *   Ahora la portada trae solo las carreras —una lista corta que no crece con
 *   los laboratorios— y esto se pide al elegir una. El tamaño de la respuesta
 *   depende del plan de estudios de esa carrera, no de cuántos laboratorios
 *   existan en total.
 *
 * POR QUÉ UNA SOLA LLAMADA Y NO DOS
 *   Se podría pedir las materias al elegir carrera y los laboratorios al
 *   elegir materia. Serían dos esperas en vez de una, y la segunda caería
 *   justo en medio de la decisión del estudiante. Traer las dos cosas juntas
 *   cuesta unas pocas filas más y hace que el resto de la cascada sea
 *   instantáneo.
 */
export async function cargarOfertaCarrera(
  programId: string
): Promise<OfertaCarrera> {
  const vacio: OfertaCarrera = { subjects: [], labsBySubject: {} };
  if (!programId) return vacio;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("oferta_de_carrera", {
    p_program_id: programId,
  });
  if (error) return vacio;

  const filas = (data ?? []) as {
    subject_id: string;
    subject_code: string;
    subject_name: string;
    lab_code: string;
    lab_name: string;
  }[];

  // La consulta devuelve una fila por combinación materia×laboratorio; aquí se
  // pliega a la forma que el wizard ya sabía consumir.
  const porMateria = new Map<string, Subject>();
  const labsBySubject: Record<string, Lab[]> = {};

  for (const f of filas) {
    if (!porMateria.has(f.subject_id)) {
      porMateria.set(f.subject_id, {
        id: f.subject_id,
        code: f.subject_code,
        name: f.subject_name,
      });
    }
    (labsBySubject[f.subject_id] ??= []).push({
      code: f.lab_code,
      name: f.lab_name,
    });
  }

  return { subjects: [...porMateria.values()], labsBySubject };
}

export type ResultadoFranja = {
  session_id: string;
  ok: boolean;
  /** uuid del grupo cuando la reserva fue en equipo; null si fue individual */
  group_id: string | null;
  /** cuántas reservas se crearon en esa franja (1 + compañeros) */
  creadas: number;
  error: string | null;
  /** ids de las reservas creadas; se usan para avisar al laboratorista */
  reservation_ids: string[] | null;
};

export type ResultadoSolicitud =
  | { ok: true; resultados: ResultadoFranja[] }
  | { ok: false; error: string };

/**
 * Crea las reservas de las franjas seleccionadas.
 * El RPC es tolerante a fallos parciales: devuelve una fila por franja, así que
 * si una se llenó mientras el estudiante decidía, las demás sí se crean.
 */
export async function solicitarReservas(input: {
  sessionIds: string[];
  subjectId: string;
  fullName: string;
  email: string;
  code: string;
  materia?: string;
  /** Compañeros de grupo, sin incluir a quien llena el formulario. */
  integrantes?: Integrante[];
  /** Marcó la casilla de autorización de tratamiento de datos. */
  autorizaDatos?: boolean;
  /** Carrera elegida. No se deduce de la materia: una materia puede ser de varias. */
  programId?: string | null;
}): Promise<ResultadoSolicitud> {
  if (input.sessionIds.length === 0) {
    return { ok: false, error: "No seleccionaste ninguna franja horaria." };
  }
  // Ley 1581: sin autorización no se puede tratar el dato. El RPC lo vuelve a
  // validar, porque una casilla del navegador no es una garantía.
  if (!input.autorizaDatos) {
    return {
      ok: false,
      error: "Debes autorizar el tratamiento de tus datos personales para reservar.",
    };
  }

  const supabase = await createClient();

  // Un solo RPC para ambos casos: con la lista vacía se comporta como
  // reserva individual (group_id queda en null).
  const { data, error } = await supabase.rpc("request_group_reservations_public", {
    p_session_ids: input.sessionIds,
    p_subject_id: input.subjectId,
    p_leader_name: input.fullName,
    p_leader_email: input.email,
    p_leader_code: input.code,
    p_members: input.integrantes ?? [],
    p_consent_version: POLITICA_VERSION,
    p_program_id: input.programId ?? null,
  });

  if (error) {
    // Errores que abortan toda la solicitud (datos inválidos, tope de franjas…).
    return { ok: false, error: error.message || "No se pudo enviar la solicitud." };
  }

  const resultados = (data ?? []) as ResultadoFranja[];
  const creadas = resultados.filter((r) => r.ok).map((r) => r.session_id);

  // Correo de confirmación: best-effort. Si falla, la reserva sigue siendo válida.
  if (creadas.length > 0) {
    try {
      // ── Aviso al LABORATORISTA ─────────────────────────────────────────
      //
      // AL CREAR LA RESERVA NO SE ESCRIBE AL ESTUDIANTE (decisión de la
      // División, agosto 2026). La solicitud queda en estado Pendiente y él ya
      // vio la confirmación en pantalla; su único correo llegará cuando el
      // laboratorista apruebe. Aquí solo se avisa a quien tiene que decidir:
      // sin este mensaje, nadie se entera de que hay algo por revisar y la
      // aprobación nunca ocurre.
      //
      // Los destinatarios se resuelven con un RPC porque el rol anon no puede
      // leer lab_admins ni profiles, y así debe seguir.
      // Sin esto tendría que entrar al panel "por si acaso". Se resuelven los
      // destinatarios con un RPC porque el rol anon no puede leer lab_admins
      // ni profiles, y así debe seguir.
      const idsReservas = resultados
        .filter((r) => r.ok)
        .flatMap((r) => r.reservation_ids ?? []);

      if (idsReservas.length > 0) {
        const { data: targets } = await supabase.rpc(
          "reservation_notification_targets",
          { p_reservation_ids: idsReservas }
        );

        // Un solo correo por laboratorista, con todas las solicitudes de su lab.
        type Target = {
          admin_email: string;
          admin_name: string | null;
          lab_name: string;
          session_date: string;
          start_time: string;
          end_time: string;
          student_name: string | null;
          student_code: string | null;
          subject_name: string | null;
          en_grupo: boolean;
        };
        const porAdmin = new Map<string, { t: Target; filas: Target[] }>();
        for (const t of (targets ?? []) as Target[]) {
          const clave = `${t.admin_email}|${t.lab_name}`;
          const entrada = porAdmin.get(clave) ?? { t, filas: [] };
          entrada.filas.push(t);
          porAdmin.set(clave, entrada);
        }

        for (const { t, filas: fs } of porAdmin.values()) {
          const { asunto, html } = correoNuevaSolicitud({
            laboratorista: t.admin_name,
            labName: t.lab_name,
            solicitudes: fs.map((f) => ({
              estudiante: f.student_name ?? "Estudiante",
              codigo: f.student_code ?? "",
              materia: f.subject_name,
              sessionDate: f.session_date,
              startTime: f.start_time,
              endTime: f.end_time,
              enGrupo: f.en_grupo,
            })),
          });
          await enviarCorreo({ para: t.admin_email, asunto, html });
        }
      }
    } catch (e) {
      console.error("[reservar] no se pudo enviar el correo:", (e as Error).message);
    }
  }

  return { ok: true, resultados };
}
