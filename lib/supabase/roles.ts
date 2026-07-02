// lib/supabase/roles.ts — criterio único de rol → home, compartido por proxy, signIn y "/"
import type { SupabaseClient } from "@supabase/supabase-js";

export type Role = "estudiante" | "laboratorista" | "jefe";

// Home de cada rol tras iniciar sesión
export const ROLE_HOME: Record<string, string> = {
  estudiante: "/laboratorios",
  laboratorista: "/panel",
  jefe: "/dashboard",
};

export async function getUserRole(
  supabase: SupabaseClient,
  userId: string
): Promise<Role> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[roles] error al leer profiles.role:", error.message);
  }
  return (profile?.role as Role) ?? "estudiante";
}
