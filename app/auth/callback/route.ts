// app/auth/callback/route.ts — intercambia el código por sesión (confirmación de correo)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // El middleware enruta a "/" → home según rol
  return NextResponse.redirect(`${origin}/`);
}
