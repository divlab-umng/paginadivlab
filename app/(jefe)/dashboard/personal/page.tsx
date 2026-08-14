// app/(jefe)/dashboard/personal/page.tsx — gestión de cuentas del personal.
// Aquí el jefe aprueba las solicitudes de registro y asigna laboratorios.
// Hasta esta pantalla, la asignación en `lab_admins` solo se podía hacer por SQL.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/supabase/roles";
import { StaffManager } from "@/components/dashboard/staff-manager";
import type {
  StaffRow,
  LabOption,
} from "@/app/(jefe)/dashboard/personal/actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Personal · UMNG" };

export default async function PersonalPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await getUserRole(supabase, user.id);
  if (role !== "jefe") redirect("/");

  // Ambos RPC devuelven vacío si quien llama no es jefe (doble candado).
  const [{ data: staffData, error: staffError }, { data: labsData }] =
    await Promise.all([
      supabase.rpc("list_staff"),
      supabase.rpc("list_labs_for_admin"),
    ]);

  const personal = (staffData ?? []) as StaffRow[];
  const laboratorios = (labsData ?? []) as LabOption[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <Link
          href="/dashboard"
          className="text-sm text-[var(--umng-navy)] hover:underline"
        >
          ← Volver al panel
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold text-[var(--umng-navy)]">
          Personal
        </h1>
        <p className="mt-1 text-sm text-[var(--umng-ink)]/70">
          Aprueba las solicitudes de acceso y asigna a cada laboratorista los
          laboratorios que administrará.
        </p>
      </header>

      {staffError ? (
        <p className="rounded-lg border border-[var(--umng-crimson)] bg-red-50 p-4 text-sm text-[var(--umng-ink)]">
          No se pudo cargar el personal: {staffError.message}
        </p>
      ) : (
        <StaffManager
          personal={personal}
          laboratorios={laboratorios}
          miId={user.id}
        />
      )}
    </main>
  );
}
