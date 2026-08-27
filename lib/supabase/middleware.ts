// lib/supabase/middleware.ts — refresca la sesión y aplica RBAC por ruta
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ROLE_HOME, getUserRole } from "@/lib/supabase/roles";

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

  // Rutas del flujo público del estudiante: alcanzables SIEMPRE, haya sesión o no.
  // Si no se distinguen, un laboratorista (o cualquiera con sesión) que entre a
  // /reservar sale rebotado a su panel y nunca ve la página pública.
  const isAlwaysPublic =
    path.startsWith("/reservar") ||          // flujo del estudiante SIN login
    path.startsWith("/entrada") ||           // QR de entrada inmediata en la puerta
    path.startsWith("/consulta") ||          // seguimiento por código + correo
    path.startsWith("/registro-personal") || // alta de personal (queda pendiente)
    path.startsWith("/politica-datos") ||    // habeas data: siempre consultable
    path.startsWith("/auth");

  const isPublic =
    path === "/" ||
    path.startsWith("/login") || // con sesión abierta sí redirige: ya entraste
    isAlwaysPublic;

  // Sin sesión y ruta protegida → login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    const role = await getUserRole(supabase, user.id);

    // Bloquea áreas que no correspondan al rol (el Jefe pasa siempre)
    for (const [prefix, needed] of ROUTE_GUARDS) {
      if (path.startsWith(prefix) && role !== needed && role !== "jefe") {
        const url = request.nextUrl.clone();
        url.pathname = ROLE_HOME[role] ?? "/reservar";
        return NextResponse.redirect(url);
      }
    }

    // Ya autenticado en la landing o el login → a su home.
    // Las rutas del flujo público quedan exentas: se ven con o sin sesión.
    if (isPublic && !isAlwaysPublic) {
      const url = request.nextUrl.clone();
      url.pathname = ROLE_HOME[role] ?? "/reservar";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
