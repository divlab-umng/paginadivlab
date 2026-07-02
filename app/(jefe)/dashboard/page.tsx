import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--umng-surface)" }}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--umng-border)] bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-[var(--umng-navy)]">
          Panel de jefe
        </h1>
        <p className="mt-2 font-data text-sm text-[var(--umng-muted)]">
          {user?.email}
        </p>
      </div>
    </div>
  );
}
