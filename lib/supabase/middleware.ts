// lib/supabase/middleware.ts — refresca la sesión y aplica RBAC por ruta
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Home de cada rol tras iniciar sesión
const ROLE_HOME: Record<string, string> = {
  estudiante: "/laboratorios",
  laboratorista: "/panel",
  jefe: "/dashboard",
};

// Prefijo de ruta → rol mínimo requerido (el Jefe puede entrar a todo)
const ROUTE_GUARDS: [string, string][] = [
  ["/panel", "laboratorista"],
  ["/dashboard", "jefe"],
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANTE: getUser() revalida el token contra el servidor de Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/registro") ||
    path.startsWith("/auth");

  // Sin sesión y ruta protegida → login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError) {
      console.error("[proxy] error al leer profiles.role:", profileError.message);
    }
    const role = profile?.role ?? "estudiante";

    // Bloquea áreas que no correspondan al rol (el Jefe pasa siempre)
    for (const [prefix, needed] of ROUTE_GUARDS) {
      if (path.startsWith(prefix) && role !== needed && role !== "jefe") {
        const url = request.nextUrl.clone();
        url.pathname = ROLE_HOME[role] ?? "/laboratorios";
        return NextResponse.redirect(url);
      }
    }

    // Ya autenticado en login/registro → a su home
    if (isPublic && !path.startsWith("/auth")) {
      const url = request.nextUrl.clone();
      url.pathname = ROLE_HOME[role] ?? "/laboratorios";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
