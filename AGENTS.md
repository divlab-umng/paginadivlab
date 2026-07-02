# AGENTS.md — Plataforma de Reserva de Laboratorios UMNG

Contexto de proyecto para agentes de IA (Claude Code). Léelo antes de tocar código.

## Qué es

Plataforma web para gestión, monitoreo y reserva de prácticas en los laboratorios
de la Universidad Militar Nueva Granada (UMNG). Gestiona **únicamente el aforo
físico** (cupo para entrar al laboratorio). El préstamo de máquinas, equipos o
materiales está **fuera de alcance**: no crear lógica de inventario.

## Stack

- **Framework**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 (config CSS-first en `app/globals.css`, no `tailwind.config.js`).
- **Backend/DB/Auth/Storage**: Supabase (PostgreSQL). Cliente vía `@supabase/ssr`.
- **Emails**: Resend (plantillas con logo UMNG).
- **Despliegue objetivo**: Vercel.
- Import alias: `@/*` apunta a la raíz del proyecto.

## Roles (RBAC)

- **estudiante**: ve laboratorios, descarga PDF de requisitos, solicita reservas en
  bloques con aforo disponible, ve el estado de su solicitud, cancela su reserva.
  Registro/acceso **solo** con correo `@unimilitar.edu.co`.
- **laboratorista**: administra **solo sus labs asignados**. Configura bloques
  horarios fijos y aforo, actualiza el PDF, aprueba/rechaza solicitudes.
- **jefe** (super admin): vista global. Dashboard con métricas (uso de labs,
  volumen de prácticas, franjas de mayor demanda, asistencia).

## Reglas de negocio (no romper)

1. **Horarios fijos, no libres**: el estudiante solo reserva en bloques predefinidos
   (`schedule_blocks`), materializados por fecha en `block_sessions`.
2. **Aforo sin sobrecupo**: una reserva `pendiente` o `aprobada` ocupa cupo. El
   control de concurrencia es atómico (bloqueo `FOR UPDATE`) dentro de los RPC.
3. **Cancelación sin penalidad**: no hay sistema de no-shows. Cancelar libera el cupo.
4. **Correos**: al aprobar → correo de confirmación (fecha, hora, implementos). Al
   cancelar → notificación opcional. Se disparan desde Server Actions tras el RPC.

## Base de datos

Esquema completo en `supabase/migrations/0001_init.sql`. Tablas: `profiles`,
`laboratories`, `lab_admins`, `schedule_blocks`, `block_sessions`, `reservations`.

**Toda mutación de reservas pasa por RPCs `SECURITY DEFINER`** (no hacer INSERT/UPDATE
directo a `reservations`):
- `request_reservation(session_id)` — estudiante solicita (valida aforo atómicamente).
- `cancel_reservation(reservation_id)` — estudiante cancela.
- `decide_reservation(reservation_id, approve, reason)` — laboratorista/jefe decide.
- `ensure_sessions(lab_id, from, to)` — materializa sesiones de un rango (idempotente).

**RLS activo** en todas las tablas. Helpers: `user_role()`, `is_jefe()`,
`is_lab_admin(lab_id)`. Vistas para dashboard: `v_lab_usage`, `v_demanda_horaria`,
`v_ocupacion_sesion`.

## Identidad visual UMNG

Paleta del escudo (definida como variables en `app/globals.css`):

- `--umng-navy #0B254E` — headers, menús (azul marino profundo)
- `--umng-crimson #C41E3A` — botones de acción / alertas (rojo carmesí)
- `--umng-gold #FDB913` — estado "Pendiente" / detalles (dorado/mostaza)
- `--umng-green #2E7D32` — estado "Aprobada" / éxito
- Fondo blanco limpio. Tinta `--umng-ink #0F1B2D`.

Tipografía: **Libre Franklin** (títulos), **Inter** (cuerpo), **IBM Plex Mono**
(datos: códigos de lab, horas, aforos — clase `.font-data`).

Estados de reserva → clases badge: `badge-pendiente` (dorado), `badge-aprobada`
(verde), `badge-rechazada` (carmesí), `badge-cancelada` (gris).

## Estructura de carpetas objetivo

```
app/
  (auth)/login/page.tsx
  (auth)/registro/page.tsx
  (auth)/actions.ts
  (estudiante)/laboratorios/page.tsx
  (estudiante)/laboratorios/[code]/page.tsx
  (estudiante)/mis-reservas/page.tsx
  (laboratorista)/panel/page.tsx
  (laboratorista)/panel/horarios/page.tsx
  (laboratorista)/panel/solicitudes/page.tsx
  (jefe)/dashboard/page.tsx
  auth/callback/route.ts
  globals.css
components/ui/           (botones, badges, cards)
components/auth/login-form.tsx
components/reservas/
components/dashboard/
lib/supabase/{client,server,middleware}.ts
lib/email/               (Resend + plantillas)
lib/types/database.types.ts   (generar con: supabase gen types typescript)
emails/                  (plantillas con logo UMNG)
middleware.ts            (raíz)
```

## Variables de entorno (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
RESEND_API_KEY=
```

## Colocación de los archivos ya generados

Hay 9 archivos base descargados (probablemente en la carpeta Descargas del usuario).
Muévelos a estas rutas exactas (cada archivo lleva su ruta destino en el comentario
de la primera línea):

| Archivo descargado       | Ruta destino en el proyecto        |
|--------------------------|------------------------------------|
| `schema.sql`             | `supabase/migrations/0001_init.sql` |
| `globals.css`            | `app/globals.css` (reemplazar)      |
| `client.ts`              | `lib/supabase/client.ts`            |
| `server.ts`              | `lib/supabase/server.ts`            |
| `supabase-middleware.ts` | `lib/supabase/middleware.ts`        |
| `middleware.ts`          | `middleware.ts` (raíz)              |
| `actions.ts`             | `app/(auth)/actions.ts`             |
| `callback-route.ts`      | `app/auth/callback/route.ts`        |
| `login-form.tsx`         | `components/auth/login-form.tsx`    |

## Convenciones

- Comunicación y comentarios en **español**.
- Server Components por defecto; `'use client'` solo cuando haga falta interactividad.
- No exponer datos personales en URLs. Respetar RLS: nunca filtrar en el cliente lo
  que debe filtrar la base de datos.
- No introducir lógica de inventario/préstamo de equipos.

## Estado actual

**Completado:**
- Base de datos Supabase aplicada: 6 tablas (`profiles`, `laboratories`, `lab_admins`,
  `schedule_blocks`, `block_sessions`, `reservations`) con RLS activo en todas.
- `.env.local` configurado.
- Fuentes UMNG (Libre Franklin, Inter, IBM Plex Mono) cargadas vía `next/font/google`
  en `app/layout.tsx`, expuestas como `--font-display`, `--font-sans`, `--font-mono`.
- Login funcional: `app/(auth)/login/page.tsx` importa `LoginForm` desde
  `components/auth/login-form.tsx` (HTTP 200 verificado).
- Registro funcional en `/registro` (`app/(auth)/registro/page.tsx` +
  `components/auth/register-form.tsx`), con validación del dominio
  `@unimilitar.edu.co` en tres capas: cliente (pattern del input), server action
  (`signUp` en `app/(auth)/actions.ts`) y trigger `handle_new_user` en la DB.
- Shells mínimos por rol: `/laboratorios` (estudiante), `/panel` (laboratorista),
  `/dashboard` (jefe) — cada uno muestra "Panel de [rol]" y el correo autenticado.
- `middleware.ts` renombrado a `proxy.ts` (convención Next.js 16); la función
  exportada pasó de `middleware` a `proxy`.
- Migración `supabase/migrations/0002_grants.sql`: corrige el bug de RBAC donde
  el proxy leía `profiles.role` pero la consulta fallaba con "permission denied"
  (42501) por falta de `GRANT` de tabla a `authenticated` — RLS ya filtraba
  correctamente, pero faltaban los privilegios base. Con el GRANT aplicado, el
  fallback silencioso a `"estudiante"` dejó de esconder el error.
- RBAC verificado de punta a punta para los tres roles (estudiante, laboratorista,
  jefe): acceso permitido a su home y bloqueo cruzado confirmado hacia las áreas
  de los otros roles.

**Pendiente:**
- Redirección post-login por rol: `signIn` hoy redirige a `/` y ese comentario
  asume que "el middleware redirige al home según el rol", pero el proxy solo
  aplica esa redirección cuando la ruta es `/login` o `/registro`; en `/` deja
  pasar la petición sin redirigir. Falta cerrar ese salto.
- Reemplazar la página raíz (`app/page.tsx` sigue siendo la plantilla por defecto
  de Next.js).
- Construir la vista de laboratorios del estudiante (`(estudiante)/laboratorios/`
  hoy es solo el shell mínimo, falta listar labs/bloques/aforo real).

## Próximo paso sugerido

Construir la página de disponibilidad del estudiante
(`(estudiante)/laboratorios/[code]/page.tsx`) que llama a `ensure_sessions` y muestra
bloques con cupos, con botón de reserva vía `request_reservation`.
