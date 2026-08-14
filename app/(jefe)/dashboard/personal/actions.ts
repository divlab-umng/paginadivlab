// app/(jefe)/dashboard/personal/actions.ts — gestión de cuentas del personal.
// La autorización real la hacen los RPCs (todos exigen is_jefe()); aquí solo se
// traduce el resultado a algo que la interfaz pueda mostrar.
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type StaffRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: "estudiante" | "laboratorista" | "jefe";
  staff_requested_at: string | null;
  created_at: string;
  lab_ids: string[];
  lab_codes: string[];
};

export type LabOption = { id: string; code: string; name: string };

export type AccionResult = { ok: true } | { ok: false; error: string };

export async function cambiarRol(
  userId: string,
  role: "estudiante" | "laboratorista" | "jefe"
): Promise<AccionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", {
    p_user_id: userId,
    p_role: role,
  });
  if (error) {
    return { ok: false, error: error.message || "No se pudo cambiar el rol." };
  }
  revalidatePath("/dashboard/personal");
  return { ok: true };
}

export async function asignarLaboratorios(
  adminId: string,
  labIds: string[]
): Promise<AccionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_lab_admins", {
    p_admin_id: adminId,
    p_lab_ids: labIds,
  });
  if (error) {
    return { ok: false, error: error.message || "No se pudieron asignar los laboratorios." };
  }
  revalidatePath("/dashboard/personal");
  return { ok: true };
}
