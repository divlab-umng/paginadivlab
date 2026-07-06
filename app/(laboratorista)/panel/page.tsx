// app/(laboratorista)/panel/page.tsx — Bandeja de solicitudes pendientes (laboratorista)
import { createClient } from "@/lib/supabase/server";
import { RequestInbox } from "@/components/panel/request-inbox";

export const dynamic = "force-dynamic";

export type SolicitudRow = {
  id: string;
  created_at: string;
  student_email: string;
  student_name: string | null;
  lab_code: string;
  lab_name: string;
  session_date: string;
  start_time: string;
  end_time: string;
};

export default async function PanelPage() {
  const supabase = await createClient();

  // RLS ya limita las reservas a los labs que este laboratorista administra.
  const { data: pend, error } = await supabase
    .from("reservations")
    .select(
      `id, created_at, student_id,
       block_sessions!inner (
         session_date, start_time, end_time,
         laboratories!inner ( code, name )
       )`
    )
    .eq("status", "pendiente")
    .order("created_at", { ascending: true });

  // Nombres/correos de los solicitantes en consulta aparte: evita la ambigüedad
  // de las dos FKs de reservations → profiles (student_id y decided_by).
  const ids = [...new Set((pend ?? []).map((r) => r.student_id as string))];
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
    const est = students.get(r.student_id as string);
    return {
      id: r.id,
      created_at: r.created_at,
      student_email: est?.email ?? "—",
      student_name: est?.full_name ?? null,
      lab_code: s.laboratories.code,
      lab_name: s.laboratories.name,
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
    };
  });

  return (
    <div className="min-h-screen bg-white">
      <header className="umng-header">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <p className="font-data text-xs uppercase tracking-widest text-white/70">
            UMNG · Panel del laboratorista
          </p>
          <h1 className="mt-1 text-2xl text-white">Solicitudes pendientes</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {error ? (
          <p className="rounded-lg bg-surface p-4 text-crimson">
            No se pudieron cargar las solicitudes. Intenta recargar la página.
          </p>
        ) : (
          <RequestInbox solicitudes={solicitudes} />
        )}
      </main>
    </div>
  );
}
