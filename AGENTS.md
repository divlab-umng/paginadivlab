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

## Infraestructura y titularidad de cuentas

Estado: **julio 2026** — migrado de cuentas personales a identidad institucional (`juans.vargas@unimilitar.edu.co`) como paso previo a la adopción formal por la UMNG.

- **Repositorio**: `github.com/divlab-umng/paginadivlab` (privado). Vive bajo la organización de GitHub `divlab-umng`, propiedad (por ahora) de la cuenta `VARGASBORDA-JS` con el correo institucional verificado y **2FA activo**. Antes estaba en `github.com/VARGASBORDA-JS/paginadivlab` (GitHub deja redirección automática desde la URL vieja).
- **Supabase**: proyecto `reservas-labs-umng` (ref `fabvriqzqnhzxpxrunil`, región `us-east-1`) bajo la organización `divlab-umng` (tipo Educational, plan Free). La transferencia entre organizaciones **conservó URL y API keys**: `.env.local` no cambió. Antes estaba en `VARGASBORDA-JS's Org`.
- **Vercel**: aún **sin desplegar**. El montaje se hará cuando el despliegue esté aprobado por la institución (subdominio `unimilitar.edu.co`, dominio verificado de Resend, revisión de la OFITIC). No es "migración" sino montaje limpio.

**Nota operativa (plan Free de Supabase):** los proyectos se pausan tras 7 días de inactividad de la base de datos. La pausa **no borra datos**; se reanuda desde el dashboard ("Resume project"). Pendiente: keep-alive (GitHub Action) o subir a Pro en producción.

**Modelo de gobernanza (propuesto, a confirmar con jefatura/coordinación):**
- Dueño funcional del proceso: **División de Laboratorios**.
- Dueño técnico / custodio: **Oficina Asesora de TIC (OFITIC)** — infraestructura, seguridad (MSPI, Resolución 4352 de 2016), gestor de identidad institucional.
- Desarrollador/mantenedor: Juan Sebastian Vargas (rol asignado, no dueño de cuentas).
- Meta: que estas organizaciones pasen a ser de la OFITIC con el mantenedor como administrador (segunda migración, mismo patrón de 5 pasos: preparar destino → verificar roles → transferir → actualizar referencias → verificar).

**Cumplimiento pendiente para "go-live" (entidad pública, Ley 1581 de 2012):** política de tratamiento de datos + autorización (habeas data) en el registro, inscripción en el RNBD (SIC), contrato de transmisión internacional (Supabase en EE.UU., país con nivel adecuado según la SIC), y revisión de seguridad de la OFITIC (MSPI). La validación actual del correo por *patrón* `@unimilitar.edu.co` debería migrar a integración con el **gestor de identidad institucional** (SSO), que además resuelve la verificación real de estudiante.

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
components/labs/
components/reservas/
components/panel/
components/dashboard/
lib/supabase/{client,server,middleware}.ts   (el proxy raíz es proxy.ts; este middleware de supabase conserva su nombre)
lib/email/               (Resend + plantillas)
lib/types/database.types.ts   (generar con: supabase gen types typescript)
emails/                  (plantillas con logo UMNG)
proxy.ts                (raíz, era middleware.ts — convención Next 16)
```

## Variables de entorno (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
RESEND_API_KEY=
```

En producción, `NEXT_PUBLIC_SITE_URL` debe ser la URL pública real (dominio de Vercel o subdominio institucional), **no** `localhost`. La URL y las keys de Supabase **no cambiaron** con la migración de organización.

## Colocación de los archivos base (histórico — ya aplicado)

Registro histórico del bootstrap inicial: estos 9 archivos base ya fueron
colocados en sus rutas. No es una tarea pendiente; se conserva como referencia
de dónde vive cada pieza fundacional.

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
- Helper compartido `lib/supabase/roles.ts` (`ROLE_HOME` + `getUserRole`): unifica
  el criterio de rol → home entre el proxy, `signIn` y la página raíz, en vez de
  duplicar la consulta a `profiles` en cada lugar.
- Redirección post-login por rol: `signIn` (en `app/(auth)/actions.ts`) ahora lee
  el rol con `getUserRole` justo tras autenticar y redirige directo a
  `ROLE_HOME[role]`, sin rebotar por `/`.
- Landing institucional UMNG en la raíz (`app/page.tsx`): visitantes sin sesión
  ven la landing (título, línea institucional, botones "Ingresar"/"Registrarse");
  con sesión activa, redirige al panel del rol vía `ROLE_HOME`/`getUserRole`.
  Para que la landing sea alcanzable, se agregó `path === "/"` (match exacto, no
  por prefijo) a las rutas públicas del proxy en `lib/supabase/middleware.ts`.
- Vista de laboratorios del estudiante construida y verificada en el navegador.
  Datos: la tabla `laboratories` está cargada con ~50 laboratorios (dinámico: la
  cantidad se lee de la tabla `laboratories`, no está hardcodeada); hay bloques
  horarios de prueba en 3 labs (`METALES`, `ROBOTICA`, `AUTOMATIZACION_CONTROL`)
  con sesiones materializadas vía `ensure_sessions`. Estos seeds ya están
  versionados en `supabase/migrations/0003_seed_labs.sql` (labs) y
  `0004_seed_blocks.sql` (bloques de prueba).
- Convención de `code`: slug en MAYÚSCULAS sin tildes, sin prefijo "LABORATORIO"
  (p.ej. `METALES`, `AUTOMATIZACION_CONTROL`). Las rutas del estudiante usan
  `code`, no UUID.
- Pieza 1 — Lista `/laboratorios` (`app/(estudiante)/laboratorios/page.tsx` +
  `components/labs/lab-card.tsx`): grid con badge de disponibilidad real leída de
  `block_sessions` (ventana de 7 días). Verificada.
- Pieza 2 — Detalle `/laboratorios/[code]` (`[code]/page.tsx` +
  `session-list.tsx` + `request-button.tsx` + `actions.ts`): sesiones agrupadas
  por día con "X de Y cupos"; botón "Solicitar" → Server Action → RPC
  `request_reservation` (atómico) + `revalidatePath`; auto-`ensure_sessions` al
  abrir el detalle. Verificado end-to-end (reserva creada, cupo 20→19, badge
  "Solicitada", candado anti-doble-reserva). Solo funciona con rol estudiante.
- Decisión: la creación de `schedule_blocks` desde el panel del laboratorista
  queda como feature futura; por ahora los bloques se siembran vía SQL.
- Pieza 3 — "Mis reservas" (`app/(estudiante)/mis-reservas/page.tsx` +
  `actions.ts` + `components/reservas/reservation-list.tsx` +
  `cancel-button.tsx`): lista las reservas del estudiante agrupadas en
  Próximas/Pasadas con badges de estado; cancelar vía Server Action → RPC
  `cancel_reservation` + `revalidatePath`, con confirmación en dos pasos.
  Enlace "Mis reservas" en el header de `/laboratorios`. Verificado
  end-to-end (cancelación libera cupo). Fix de zona horaria en el cálculo de
  "hoy" (local, no UTC).
- Panel del laboratorista (`app/(laboratorista)/panel/page.tsx` + `actions.ts` +
  `components/panel/request-inbox.tsx` + `decision-buttons.tsx`): bandeja de
  solicitudes pendientes de los labs asignados (RLS filtra por
  `is_lab_admin`); aprobar (un clic) o rechazar (con motivo opcional) vía
  Server Action → RPC `decide_reservation` + `revalidatePath`. Verificado
  end-to-end: aprobar y rechazar con motivo, ambos persistidos (`status`,
  `decision_reason`, `decided_by`, `decided_at`). La asignación
  laboratorista↔lab se hace en `lab_admins` (por ahora vía SQL directo).
- Migración `supabase/migrations/0005_fix_decide_reservation.sql`: corrige el
  RPC `decide_reservation`, que fallaba con "column status is of type
  reservation_status but expression is of type text" — el `CASE` devolvía
  `text` y faltaba el cast explícito `::public.reservation_status` en el
  `UPDATE`.
- Gestión de `schedule_blocks` desde el panel del laboratorista
  (`app/(laboratorista)/panel/horarios/`: `page.tsx` + `actions.ts` +
  `components/panel/block-form.tsx` + `block-list.tsx`): el laboratorista crea
  bloques (día ISO, hora inicio/fin, aforo) y los desactiva con confirmación en
  dos pasos, todo vía RPCs `SECURITY DEFINER` (`create_schedule_block`,
  `deactivate_schedule_block`, `my_admin_labs`) + `revalidatePath`. Al crear un
  bloque se materializan 8 semanas de sesiones vía `ensure_sessions`. Migración
  `0006_schedule_blocks_mgmt.sql` (RPCs + RLS de lectura + helper), corregida por
  `0007_fix_schedule_block_active.sql`: la columna real es `is_active` (no
  `active`) y `weekday` usa convención ISO (1=Lunes … 7=Domingo, `isodow`).
  Verificado end-to-end: crear bloque → sesión materializada en el día y aforo
  correctos → listado del panel poblado. Ya no se siembran por SQL.
- Dashboard del jefe v1 (`app/(jefe)/dashboard/page.tsx` +
  `components/dashboard/lab-usage-table.tsx` + `top-franjas.tsx`): vista global
  con validación de rol `jefe`. Consume las vistas `v_lab_usage` y
  `v_demanda_horaria` (Server Component, `security_invoker` respeta RLS). Tres
  capas: tarjetas resumen (aprobadas, pendientes, total labs, total reservas),
  tabla de uso por lab (filtrada a labs con actividad para evitar ruido de ~50
  filas en cero), y ranking de franjas más demandadas (mapea `lab_id`→nombre
  porque la vista solo trae el UUID; día en ISO). Manejo de error visible en
  pantalla, no silencioso. Verificado e2e con datos reales de prueba. La tarjeta
  de asistencia se omitió a propósito: `attended` aún no se registra en la
  práctica.
- **Migración de infraestructura a identidad institucional (julio 2026):** repo transferido a la organización de GitHub `divlab-umng` (2FA activo, correo institucional verificado; remoto local reapuntado y `git push` verificado), y proyecto de Supabase transferido a la organización `divlab-umng` (conservando URL, API keys y datos: 50 labs, 12 bloques activos, 2 perfiles verificados tras la transferencia). Detalle en la sección "Infraestructura y titularidad de cuentas".

**Deuda técnica conocida (no urgente):**
- La asignación laboratorista↔lab (`lab_admins`) se hace por SQL directo; falta UI para que el jefe la gestione.
- Al desactivar un bloque (`deactivate_schedule_block`) solo se marca `is_active = false`; las sesiones futuras ya materializadas en `block_sessions` no se limpian (podrían tener reservas). Falta decidir la política de limpieza al revisar el esquema de `block_sessions`.
- El dashboard no muestra asistencia (tarjeta ni columnas) porque `attended` aún no se registra; `v_lab_usage` ya expone `asistencias`/`inasistencias` para cuando exista el flujo de registro.
- Faltan generar los tipos de la BD (`lib/types/database.types.ts` con `supabase gen types typescript`); hoy se tipan las consultas a mano con casts.
- **Falta recrear un usuario de prueba `laboratorista`**: hoy solo existen perfiles `estudiante` (`est.juan.vargas9@unimilitar.edu.co`) y `jefe` (`juans.vargas@unimilitar.edu.co`); sin un laboratorista con lab asignado en `lab_admins`, el panel del laboratorista no es testeable end-to-end.
- **Vercel sin desplegar**: el "go-live" depende de decisiones institucionales (adopción por la UMNG, subdominio, dominio verificado de Resend, revisión OFITIC/MSPI, cumplimiento Ley 1581). Ver sección de infraestructura.
- **API keys de Supabase**: hoy se usa la `anon` legacy; Supabase la deprecia a fin de 2026 a favor de `publishable`/`secret`. Migrar al preparar producción, por separado de otros cambios.
- **Anti-pausa del plan Free**: montar keep-alive o subir a Pro antes de tener tráfico real, para que la DB no se pause por inactividad.

## Próximo paso sugerido

Infraestructura ya migrada a cuentas institucionales (GitHub + Supabase). Los dos frentes en cola:

**Producto:** iterar el dashboard (gráficos donde aporten, p.ej. demanda por franja en barras; incorporar `v_ocupacion_sesion`; filtros por rango de fechas o por lab); recrear el usuario de prueba `laboratorista`; UI para asignar `lab_admins`; generar `lib/types/database.types.ts`; limpieza de `block_sessions` al desactivar un bloque; registro de asistencia (`attended`).

**Institucional / despliegue:** confirmar el modelo de gobernanza con jefatura y coordinación; obtener contactos de la OFITIC (técnico/seguridad) y del área de protección de datos; resolver el cumplimiento de la Ley 1581 (política de tratamiento, autorización en el registro, RNBD, contrato de transmisión, revisión MSPI); y recién entonces montar Vercel y publicar. Considerar un piloto controlado (p.ej. labs de Metales/CIM) antes del despliegue total.
