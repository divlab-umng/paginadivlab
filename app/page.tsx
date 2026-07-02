// app/page.tsx — landing institucional o redirección al panel del rol
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HOME, getUserRole } from "@/lib/supabase/roles";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const role = await getUserRole(supabase, user.id);
    redirect(ROLE_HOME[role] ?? "/laboratorios");
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center"
      style={{ background: "var(--umng-surface)" }}
    >
      <div>
        <p className="font-data text-xs uppercase tracking-[0.2em] text-[var(--umng-navy)]">
          Universidad Militar Nueva Granada
        </p>
        <h1 className="mt-2 text-4xl font-semibold text-[var(--umng-navy)]">
          Reserva de Laboratorios
        </h1>
        <p className="mt-3 max-w-md text-[var(--umng-muted)]">
          Reserva de prácticas en los laboratorios de la Universidad Militar Nueva
          Granada.
        </p>
      </div>

      <div className="flex gap-4">
        <Link href="/login" className="btn-primary inline-block text-center">
          Ingresar
        </Link>
        <Link href="/registro" className="btn-secondary inline-block text-center">
          Registrarse
        </Link>
      </div>
    </main>
  );
}
