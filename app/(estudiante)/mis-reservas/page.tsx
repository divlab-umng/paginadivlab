// app/(estudiante)/mis-reservas/page.tsx — Reservas del estudiante (listar + cancelar)
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ReservationList } from "@/components/reservas/reservation-list";
import { cancelReservation } from "@/app/(estudiante)/mis-reservas/actions";

export const dynamic = "force-dynamic";

// Forma de cada reserva ya aplanada para la UI.
export type ReservationRow = {
  id: string;
  status: "pendiente" | "aprobada" | "rechazada" | "cancelada";
  decision_reason: string | null;
  lab_code: string;
  lab_name: string;
  session_date: string;
  start_time: string;
  end_time: string;
};

export default async function MisReservasPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Trae las reservas del estudiante con su sesión y su lab (join anidado).
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `id, status, decision_reason,
       block_sessions!inner (
         session_date, start_time, end_time,
         laboratories!inner ( code, name )
       )`
    )
    .eq("student_id", user?.id ?? "")
    .order("created_at", { ascending: false });

  // Aplana la estructura anidada de Supabase a filas simples.
  const reservas: ReservationRow[] = (data ?? []).map((r) => {
    const s = r.block_sessions as unknown as {
      session_date: string;
      start_time: string;
      end_time: string;
      laboratories: { code: string; name: string };
    };
    return {
      id: r.id,
      status: r.status,
      decision_reason: r.decision_reason,
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
          <Link
            href="/laboratorios"
            className="font-data text-xs uppercase tracking-widest text-white/70 hover:text-white"
          >
            ← Laboratorios
          </Link>
          <h1 className="mt-3 text-2xl text-white">Mis reservas</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {error ? (
          <p className="rounded-lg bg-surface p-4 text-crimson">
            No se pudieron cargar tus reservas. Intenta recargar la página.
          </p>
        ) : (
          <ReservationList reservas={reservas} cancelar={cancelReservation} />
        )}
      </main>
    </div>
  );
}
