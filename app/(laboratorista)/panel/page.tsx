// app/(laboratorista)/panel/page.tsx — Bandeja de solicitudes + registro de asistencia (laboratorista)
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BarraSesion } from "@/components/panel/barra-sesion";
import { WalkInForm } from "@/components/panel/walk-in-form";
import { RequestInbox } from "@/components/panel/request-inbox";
import { AttendanceSection } from "@/components/panel/attendance-section";

export const dynamic = "force-dynamic";

export type SolicitudRow = {
  id: string;
  created_at: string;
  student_email: string;
  student_name: string | null;
  student_code: string | null;
  lab_code: string;
  lab_name: string;
  session_date: string;
  start_time: string;
  end_time: string;
  // Grupo de trabajo (migración 0016). null = solicitud individual.
  group_id: string | null;
  is_group_leader: boolean;
};

// --- Tipos de asistencia ---
export type Asistente = {
  reservation_id: string;
  student_id: string;
  full_name: string | null;
  email: string;
  student_code: string | null;
  attended: boolean | null;
};

export type AsistenciaSesion = {
  session_id: string;
  lab_id: string;
  lab_code: string;
  lab_name: string;
  session_date: string;
  start_time: string;
  end_time: string;
  aprobadas: number;
  marcadas: number;
  // Se habilita 30 min antes del inicio (migración 0013).
  estado: "por_iniciar" | "en_curso" | "finalizada";
};

export type AsistenciaSesionConAsistentes = AsistenciaSesion & {
  asistentes: Asistente[];
};

export default async function PanelPage() {
  const supabase = await createClient();

  // === Bandeja de solicitudes pendientes =================================
  // RLS ya limita las reservas a los labs que este laboratorista administra.
  // La identidad viene de tres orígenes posibles, en orden de preferencia:
  //   1) students  → flujo público sin login (registro canónico, la fuente de verdad)
  //   2) profiles  → flujo autenticado histórico
  //   3) columnas de texto de la propia reserva (respaldo)
  const { data: pend, error } = await supabase
    .from("reservations")
    .select(
      `id, created_at, student_id, student_ref, student_name, student_email, student_code,
       group_id, is_group_leader,
       students ( full_name, email, student_code ),
       block_sessions!inner (
         session_date, start_time, end_time,
         laboratories!inner ( code, name )
       )`
    )
    .eq("status", "pendiente")
    .order("created_at", { ascending: true });

  // Perfiles solo para las reservas autenticadas (student_id no nulo): consulta
  // aparte para evitar la ambigüedad de las dos FKs reservations → profiles
  // (student_id y decided_by).
  const ids = [
    ...new Set(
      (pend ?? [])
        .map((r) => r.student_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  let students = new Map<
    string,
    { id: string; email: string; full_name: string | null }
  >();
  if (ids.length > 0) {
    const { data: studentsData } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", ids);
    students = new Map((studentsData ?? []).map((s) => [s.id, s]));
  }

  const solicitudes: SolicitudRow[] = (pend ?? []).map((r) => {
    const s = r.block_sessions as unknown as {
      session_date: string;
      start_time: string;
      end_time: string;
      laboratories: { code: string; name: string };
    };
    const canon = r.students as unknown as {
      full_name: string | null;
      email: string | null;
      student_code: string | null;
    } | null;
    const perfil = r.student_id ? students.get(r.student_id as string) : undefined;

    return {
      id: r.id,
      created_at: r.created_at,
      student_email:
        canon?.email ?? perfil?.email ?? (r.student_email as string | null) ?? "—",
      student_name:
        canon?.full_name ?? perfil?.full_name ?? (r.student_name as string | null),
      student_code:
        canon?.student_code ?? (r.student_code as string | null) ?? null,
      lab_code: s.laboratories.code,
      lab_name: s.laboratories.name,
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
      group_id: (r.group_id as string | null) ?? null,
      is_group_leader: Boolean(r.is_group_leader),
    };
  });

  // === Catálogos para la entrada inmediata ================================
  // Tres consultas pequeñas sobre tablas de catálogo, no de actividad: son
  // decenas de filas y no crecen con el uso. Se hacen aquí, en el servidor,
  // para que el formulario de walk-in abra ya poblado — con una fila de
  // estudiantes esperando, cargar los desplegables al abrir se nota.
  const { data: misLabsData } = await supabase.rpc("my_admin_labs");
  const misLabs = (misLabsData ?? []) as { id: string; code: string; name: string }[];
  const misLabIds = misLabs.map((l) => l.id);

  let materiasWalkIn: { id: string; name: string; lab_code: string }[] = [];
  if (misLabIds.length > 0) {
    const { data: slData } = await supabase
      .from("subject_labs")
      .select("lab_id, subjects!inner ( id, name, is_active )")
      .in("lab_id", misLabIds);

    const codePorLab = new Map(misLabs.map((l) => [l.id, l.code]));
    materiasWalkIn = (slData ?? [])
      .map((row) => {
        const s = row.subjects as unknown as {
          id: string;
          name: string;
          is_active: boolean;
        };
        return {
          id: s.id,
          name: s.name,
          lab_code: codePorLab.get(row.lab_id as string) ?? "",
          activa: s.is_active,
        };
      })
      .filter((m) => m.activa && m.lab_code)
      .map(({ id, name, lab_code }) => ({ id, name, lab_code }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  const { data: carrerasData } = await supabase
    .from("programs")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const carrerasWalkIn = (carrerasData ?? []) as { id: string; name: string }[];

  // === Registro de asistencia ============================================
  // El RPC ya filtra por labs administrados, sesiones ya terminadas (zona
  // horaria America/Bogota) y sesiones con reservas aprobadas por marcar.
  const { data: sesionesRaw, error: errAsist } = await supabase.rpc(
    "attendance_sessions"
  );
  const sesiones = (sesionesRaw ?? []) as AsistenciaSesion[];

  // Asistentes aprobados de esas sesiones (mismo patrón de perfiles aparte).
  const sesionIds = sesiones.map((s) => s.session_id);
  const asistentesPorSesion = new Map<string, Asistente[]>();
  if (sesionIds.length > 0) {
    // Mismo criterio de identidad que la bandeja: students → profiles → texto.
    const { data: resv } = await supabase
      .from("reservations")
      .select(
        `id, session_id, student_id, student_ref, student_name, student_email,
         student_code, attended,
         students ( full_name, email, student_code )`
      )
      .in("session_id", sesionIds)
      .eq("status", "aprobada");

    const studentIds = [
      ...new Set(
        (resv ?? [])
          .map((r) => r.student_id as string | null)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    let perfiles = new Map<
      string,
      { id: string; email: string; full_name: string | null }
    >();
    if (studentIds.length > 0) {
      const { data: perfilesData } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", studentIds);
      perfiles = new Map((perfilesData ?? []).map((p) => [p.id, p]));
    }

    for (const r of resv ?? []) {
      const canon = r.students as unknown as {
        full_name: string | null;
        email: string | null;
        student_code: string | null;
      } | null;
      const p = r.student_id ? perfiles.get(r.student_id as string) : undefined;
      const arr = asistentesPorSesion.get(r.session_id as string) ?? [];
      arr.push({
        reservation_id: r.id as string,
        // Clave estable de la persona: el estudiante canónico si existe.
        student_id: (r.student_ref ?? r.student_id ?? r.id) as string,
        full_name:
          canon?.full_name ?? p?.full_name ?? (r.student_name as string | null),
        email:
          canon?.email ?? p?.email ?? (r.student_email as string | null) ?? "—",
        student_code:
          canon?.student_code ?? (r.student_code as string | null) ?? null,
        attended: (r.attended as boolean | null) ?? null,
      });
      asistentesPorSesion.set(r.session_id as string, arr);
    }
  }

  const sesionesAsistencia: AsistenciaSesionConAsistentes[] = sesiones.map(
    (s) => ({
      ...s,
      asistentes: (asistentesPorSesion.get(s.session_id) ?? []).sort((a, b) =>
        (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email, "es")
      ),
    })
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="umng-header">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <p className="font-data text-xs uppercase tracking-widest text-white/70">
            UMNG · Panel del laboratorista
          </p>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl text-white">Solicitudes pendientes</h1>

            {/* Configurar horarios era una ruta que había que escribir a mano.
                Es la pantalla que más usa el laboratorista después de esta.
                El resto (vista pública y cerrar sesión) lo aporta BarraSesion. */}
            <BarraSesion piel="oscura">
              <Link
                href="/panel/horarios"
                className="rounded-md border border-white/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/15"
              >
                Configurar horarios
              </Link>
            </BarraSesion>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-12 px-6 py-8">
        <section>
          {error ? (
            <p className="rounded-lg bg-surface p-4 text-crimson">
              No se pudieron cargar las solicitudes. Intenta recargar la página.
            </p>
          ) : (
            <RequestInbox solicitudes={solicitudes} />
          )}
        </section>

        <section>
          <h2 className="text-xl">Registro de asistencia</h2>
          <p className="mt-1 text-sm text-muted">
            El registro se habilita 30 minutos antes de que inicie la práctica.
            Todos quedan como presentes; destilda a quienes no asistieron y
            confirma.
          </p>

          {/* Entrada inmediata: el que llega sin reserva. Va aquí y no en una
              pantalla aparte porque ocurre en el mismo momento y con el mismo
              gesto que marcar asistencia. */}
          {misLabs.length > 0 && (
            <div className="mt-4">
              <WalkInForm
                labs={misLabs.map((l) => ({ code: l.code, name: l.name }))}
                materias={materiasWalkIn}
                carreras={carrerasWalkIn}
              />
            </div>
          )}

          <div className="mt-4">
            {errAsist ? (
              <p className="rounded-lg bg-surface p-4 text-crimson">
                No se pudo cargar la asistencia. Intenta recargar la página.
              </p>
            ) : (
              <AttendanceSection sesiones={sesionesAsistencia} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
