// app/page.tsx — landing institucional o redirección al panel del rol.
// Visitante sin sesión → CTA pública para reservar (estudiante, sin login).
// Personal con sesión (laboratorista/jefe) → su panel según el rol.
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
    redirect(ROLE_HOME[role] ?? "/reservar");
  }

  return (
    <main className="hero-umng flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-data text-xs uppercase tracking-[0.24em] text-[var(--umng-gold)]">
        Universidad Militar Nueva Granada
      </p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold text-white sm:text-5xl">
        Reserva de Laboratorios
      </h1>
      <p className="mt-4 max-w-md text-white/80">
        Solicita tu práctica en línea, elige tu materia y reserva el cupo
        disponible. Rápido, sin crear cuenta.
      </p>

      <div className="mt-9 flex flex-col items-center gap-4">
        <Link
          href="/reservar"
          className="rounded-xl bg-[var(--umng-crimson)] px-8 py-3.5 text-base font-semibold text-white shadow-lg transition hover:brightness-110"
        >
          Reservar laboratorio
        </Link>
        <Link
          href="/consulta"
          className="text-sm font-semibold text-white underline-offset-4 hover:underline"
        >
          Ya reservé — consultar mis reservas
        </Link>
        <Link
          href="/login"
          className="text-sm text-white/60 underline-offset-4 hover:text-white hover:underline"
        >
          Acceso para laboratoristas y jefe
        </Link>
      </div>
    </main>
  );
}
