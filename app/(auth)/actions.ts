// app/(auth)/actions.ts — Server Actions de autenticación
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const INSTITUTIONAL_DOMAIN = "@unimilitar.edu.co";

function isInstitutional(email: string) {
  return email.trim().toLowerCase().endsWith(INSTITUTIONAL_DOMAIN);
}

// Registro. La validación de dominio ocurre en 3 capas:
//   (1) UI (login-form)  (2) aquí, en el servidor  (3) trigger en la BD (definitiva).
export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "");

  if (!isInstitutional(email)) {
    return {
      error: "Debes registrarte con tu correo institucional @unimilitar.edu.co",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) return { error: error.message };
  redirect("/login?verifica=1");
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!isInstitutional(email)) {
    return { error: "Solo se permite el acceso con correo @unimilitar.edu.co" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: "Credenciales inválidas" };

  revalidatePath("/", "layout");
  redirect("/"); // el middleware redirige al home según el rol
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
