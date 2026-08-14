// app/(auth)/actions.ts — Server Actions de autenticación
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLE_HOME, getUserRole } from "@/lib/supabase/roles";

const INSTITUTIONAL_DOMAIN = "@unimilitar.edu.co";

function isInstitutional(email: string) {
  return email.trim().toLowerCase().endsWith(INSTITUTIONAL_DOMAIN);
}

// NOTA: no existe auto-registro de ESTUDIANTES. Desde el rediseño de agosto
// 2026 reservan sin cuenta en /reservar. Lo de abajo es solo para PERSONAL.

/**
 * Alta de personal (laboratoristas y jefatura).
 * La cuenta nace SIN PERMISOS: el perfil se crea con rol `estudiante` y queda
 * marcado con `staff_requested_at`. El jefe la habilita desde /dashboard/personal.
 * Registrarse no otorga acceso a nada.
 */
export async function signUpStaff(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (fullName.length < 3) {
    return { error: "Escribe tu nombre completo." };
  }
  if (!isInstitutional(email)) {
    return { error: "Debes registrarte con tu correo institucional @unimilitar.edu.co" };
  }
  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // El trigger handle_new_user lee `staff_request` para marcar la solicitud.
      data: { full_name: fullName, staff_request: "true" },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    // El trigger de la BD rechaza dominios no institucionales con su propio mensaje.
    return { error: error.message };
  }
  return { ok: true };
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!isInstitutional(email)) {
    return { error: "Solo se permite el acceso con correo @unimilitar.edu.co" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: "Credenciales inválidas" };

  revalidatePath("/", "layout");
  const role = await getUserRole(supabase, data.user.id);
  redirect(ROLE_HOME[role] ?? "/reservar");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
