// app/(estudiante)/laboratorios/page.tsx — Lista de laboratorios (vista del estudiante)
import { createClient } from "@/lib/supabase/server";
import { LabCard } from "@/components/labs/lab-card";

export const dynamic = "force-dynamic";

type Lab = { id: string; code: string; name: string };

export default async function LaboratoriosPage() {
  const supabase = await createClient();

  // Ventana de próximos 7 días para el indicador de disponibilidad por lab.
  const hoy = new Date();
  const desde = hoy.toISOString().slice(0, 10);
  const hasta = new Date(hoy.getTime() + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [{ data: labs, error: labsError }, { data: sesiones }] =
    await Promise.all([
      supabase
        .from("laboratories")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("block_sessions")
        .select("lab_id, capacity, reserved_count")
        .eq("status", "abierta")
        .gte("session_date", desde)
        .lte("session_date", hasta),
    ]);

  // Por lab: cuántas sesiones próximas tienen al menos un cupo libre.
  const disponibilidad = new Map<string, number>();
  for (const s of sesiones ?? []) {
    if (s.capacity - s.reserved_count > 0) {
      disponibilidad.set(s.lab_id, (disponibilidad.get(s.lab_id) ?? 0) + 1);
    }
  }

  const list = (labs ?? []) as Lab[];

  return (
    <div className="min-h-screen bg-white">
      <header className="umng-header">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <p className="font-data text-xs uppercase tracking-widest text-white/70">
            UMNG · Reserva de Laboratorios
          </p>
          <h1 className="mt-1 text-2xl text-white">Laboratorios</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {labsError ? (
          <p className="rounded-lg bg-surface p-4 text-crimson">
            No se pudieron cargar los laboratorios. Intenta recargar la página.
          </p>
        ) : list.length === 0 ? (
          <p className="rounded-lg bg-surface p-6 text-muted">
            Aún no hay laboratorios registrados.
          </p>
        ) : (
          <>
            <p className="mb-6 text-sm text-muted">
              {list.length} laboratorios. Selecciona uno para ver sus bloques y
              solicitar una práctica.
            </p>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((lab) => (
                <li key={lab.id}>
                  <LabCard
                    code={lab.code}
                    name={lab.name}
                    disponibles={disponibilidad.get(lab.id) ?? 0}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
