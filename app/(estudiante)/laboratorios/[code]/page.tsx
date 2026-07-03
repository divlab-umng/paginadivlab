// app/(estudiante)/laboratorios/[code]/page.tsx — Detalle de laboratorio + sesiones
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SessionList } from "@/components/labs/session-list";
import { requestReservation } from "@/app/(estudiante)/laboratorios/actions";

export const dynamic = "force-dynamic";

function tituloLimpio(name: string) {
  return name.replace(/^LABORATORIO\s+/i, "");
}

export default async function LabDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();

  // 1. Resolver el lab por code.
  const { data: lab } = await supabase
    .from("laboratories")
    .select("id, code, name, description, location")
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (!lab) notFound();

  // 2. Ventana: próximos 7 días.
  const hoy = new Date();
  const desde = hoy.toISOString().slice(0, 10);
  const hasta = new Date(hoy.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  // 3. Auto-materializa las sesiones del rango (idempotente → la página se
  //    "auto-repara" y nunca se queda sin fechas futuras).
  await supabase.rpc("ensure_sessions", {
    p_lab_id: lab.id,
    p_from: desde,
    p_to: hasta,
  });

  // 4. Sesiones abiertas del rango + las que este estudiante ya tiene activas.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: sesiones } = await supabase
    .from("block_sessions")
    .select("id, session_date, start_time, end_time, capacity, reserved_count")
    .eq("lab_id", lab.id)
    .eq("status", "abierta")
    .gte("session_date", desde)
    .lte("session_date", hasta)
    .order("session_date", { ascending: true })
    .order("start_time", { ascending: true });

  let reservadas: string[] = [];
  if (user) {
    const { data: mis } = await supabase
      .from("reservations")
      .select("session_id")
      .eq("student_id", user.id)
      .in("status", ["pendiente", "aprobada"]);
    reservadas = (mis ?? []).map((r) => r.session_id);
  }

  const solicitar = requestReservation.bind(null, lab.code);

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
          <p className="mt-3 font-data text-xs uppercase tracking-wider text-white/60">
            {lab.code}
          </p>
          <h1 className="mt-1 text-2xl text-white">{tituloLimpio(lab.name)}</h1>
          {lab.location ? (
            <p className="mt-1 text-sm text-white/70">{lab.location}</p>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {lab.description ? (
          <p className="mb-6 text-sm text-muted">{lab.description}</p>
        ) : null}
        <SessionList
          sessions={sesiones ?? []}
          reservadas={reservadas}
          solicitar={solicitar}
        />
      </main>
    </div>
  );
}
