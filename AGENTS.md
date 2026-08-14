# AGENTS.md — Plataforma de Reserva de Laboratorios UMNG

Contexto de proyecto para agentes de IA (Claude Code). Léelo antes de tocar código.

> **Actualizado: agosto 2026**, tras el rediseño que eliminó el login del estudiante.
> Si encuentras código o documentación que asuma que los estudiantes tienen cuenta,
> está desactualizado: ese flujo se retiró. Ver "Rediseño de agosto 2026".

## Qué es

Plataforma web para gestión, monitoreo y reserva de prácticas en los laboratorios
de la Universidad Militar Nueva Granada (UMNG). Gestiona **únicamente el aforo
físico** (cupo para entrar al laboratorio). El préstamo de máquinas, equipos o
materiales está **fuera de alcance**: no crear lógica de inventario.

## Stack

- **Framework**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 (config CSS-first en `app/globals.css`, no `tailwind.config.js`).
- **Backend/DB/Auth/Storage**: Supabase (PostgreSQL). Cliente vía `@supabase/ssr`.
- **Emails**: Resend (plantillas con identidad UMNG). Envío *best-effort*, ver más abajo.
- **Códigos de barras**: `@zxing/browser` + `@zxing/library` (lectura Code 39 con la cámara).
- **Excel**: generador propio sin dependencias en `lib/xlsx.ts`.
- **Despliegue objetivo**: Vercel.
- Import alias: `@/*` apunta a la raíz del proyecto.

---

## Rediseño de agosto 2026 (lo que cambió)

El cambio de fondo: **el estudiante ya no tiene cuenta**. Antes se registraba con
correo institucional, iniciaba sesión y reservaba desde `/laboratorios`. La
usabilidad no era buena y el registro añadía fricción y carga de cumplimiento
(guardar credenciales de estudiantes bajo la Ley 1581 sin necesitarlas).

| Antes | Ahora |
|---|---|
| Estudiante con cuenta y contraseña | Formulario público sin login en `/reservar` |
| `/registro` abierto a estudiantes | Retirado. `/registro-personal` para laboratoristas y jefe |
| `/laboratorios`, `/mis-reservas` | Retiradas. Reemplazadas por `/reservar` y `/consulta` |
| Elegía lab y luego veía sus bloques | Elige **materia** → se habilitan solo sus labs |
| Lista de sesiones por día | **Calendario semanal** L–S, 6:00–19:00, selección múltiple |
| Asistencia solo con botones manuales | Botones **+ escáner del carné** (Code 39) |
| Dashboard sin métricas de semestre | Métricas por semestre + exportación a `.xlsx` |
| Solo aforo (personas) | Aforo **+ puestos de trabajo**: grupos que comparten equipo |
| `lab_admins` solo por SQL | Pantalla del jefe en `/dashboard/personal` |
| Sin autorización de datos | Casilla obligatoria + política publicada (Ley 1581) |

**El login sigue existiendo, pero solo para `laboratorista` y `jefe`.**

### Grupos de trabajo y puestos (fase 6)

Algunos labs tienen **dos recursos distintos**: aforo (personas) y puestos
(mesas, tornos, celdas). Un grupo de 4 consume 4 de aforo pero **un solo puesto**.

Se modela con `reservations.group_id`: **una fila por persona**, con el grupo
como correlación. Es deliberado — una "reserva del grupo" con los compañeros en
tabla hija rompería el escáner (cada uno escanea su carné y necesita su fila),
las métricas por estudiante y el aforo atómico.

```
personas = count(*)
puestos  = count(distinct group_id) + count(*) donde group_id is null
```

Si todos los integrantes cancelan, el grupo desaparece del conteo y el puesto se
libera solo. Si cancela uno, el grupo conserva su mesa.

**Es opcional por laboratorio.** `workstations = NULL` → sin límite de puestos;
`max_group_size` NULL o 1 → el lab no admite grupos. Los labs sin configurar se
comportan exactamente como antes.

Reglas confirmadas: **aprobación individual** (el laboratorista decide estudiante
por estudiante, no el grupo entero) y **cancelación con dos vías** (cualquiera
cancela su cupo; solo quien creó el grupo lo cancela completo).

### Alta de personal (fase 7)

`/registro-personal` → la cuenta nace con rol `estudiante`, es decir **sin
permisos**, y queda marcada con `profiles.staff_requested_at`. El jefe la habilita
en `/dashboard/personal`: asigna rol y marca los laboratorios. `set_user_role`
impide que el jefe cambie su propio rol, porque se bloquearía a sí mismo.

### Autorización de datos (Ley 1581)

Reservar exige aceptar la política; el RPC lo valida en servidor, no solo la
casilla. Se guarda en cada reserva la **versión aceptada**, la fecha y
`consent_self`: `true` = el titular autorizó, `false` = el líder del grupo
declaró tener su autorización. Esa distinción es lo que permite responder con
precisión ante un reclamo de habeas data.

La política vive en `/politica-datos` y su versión en `lib/politica-datos.ts`.
**Si cambias el texto, sube `POLITICA_VERSION`**, o quedarían reservas apuntando
a una versión cuyo contenido ya no es el que aceptaron.

---

## Infraestructura y titularidad de cuentas

Estado: **julio 2026** — migrado de cuentas personales a identidad institucional (`juans.vargas@unimilitar.edu.co`) como paso previo a la adopción formal por la UMNG.

- **Repositorio**: `github.com/divlab-umng/paginadivlab` (privado). Vive bajo la organización de GitHub `divlab-umng`, propiedad (por ahora) de la cuenta `VARGASBORDA-JS` con el correo institucional verificado y **2FA activo**. Antes estaba en `github.com/VARGASBORDA-JS/paginadivlab` (GitHub deja redirección automática desde la URL vieja).
- **Supabase**: proyecto `reservas-labs-umng` (ref `fabvriqzqnhzxpxrunil`, región `us-east-1`) bajo la organización `divlab-umng` (tipo Educational, plan Free). La transferencia entre organizaciones **conservó URL y API keys**: `.env.local` no cambió.
- **Vercel**: aún **sin desplegar**. El montaje se hará cuando el despliegue esté aprobado por la institución (subdominio `unimilitar.edu.co`, dominio verificado de Resend, revisión de la OFITIC). No es "migración" sino montaje limpio.

**Nota operativa (plan Free de Supabase):** los proyectos se pausan tras 7 días de inactividad de la base de datos. La pausa **no borra datos**; se reanuda desde el dashboard ("Resume project"). Pendiente: keep-alive (GitHub Action) o subir a Pro en producción.

**Modelo de gobernanza (propuesto, a confirmar con jefatura/coordinación):**
- Dueño funcional del proceso: **División de Laboratorios**.
- Dueño técnico / custodio: **Oficina Asesora de TIC (OFITIC)** — infraestructura, seguridad (MSPI, Resolución 4352 de 2016), gestor de identidad institucional.
- Desarrollador/mantenedor: Juan Sebastian Vargas (rol asignado, no dueño de cuentas).
- Meta: que estas organizaciones pasen a ser de la OFITIC con el mantenedor como administrador.

**Cumplimiento pendiente para "go-live" (entidad pública, Ley 1581 de 2012):** política de tratamiento de datos + autorización (habeas data) en el formulario de reserva, inscripción en el RNBD (SIC), contrato de transmisión internacional (Supabase en EE.UU.) y revisión de seguridad de la OFITIC (MSPI).

> **Nota de alcance tras el rediseño:** ya no se guardan contraseñas de estudiantes,
> pero **sí datos personales** (nombre, correo, código) en la tabla `students`. La
> obligación de habeas data sigue vigente; falta el aviso y la casilla de
> autorización en el formulario de `/reservar`.

---

## Roles (RBAC)

- **estudiante** — **NO se autentica**. Usa el flujo público:
  - `/reservar`: ingresa nombre, correo institucional y código; elige materia,
    laboratorio habilitado y franjas del calendario.
  - `/consulta`: ve el estado de sus reservas y las cancela, identificándose con
    **código + correo** (ambos obligatorios).
  - El rol `estudiante` **sigue existiendo en la BD** por los perfiles antiguos.
    Si uno de ellos inicia sesión, `ROLE_HOME` lo manda a `/reservar`.
- **laboratorista** — administra **solo sus labs asignados** (`lab_admins`).
  Configura bloques horarios y aforo, aprueba/rechaza solicitudes y registra
  asistencia (manual o escaneando carnés).
- **jefe** (super admin) — vista global. Dashboard con métricas por semestre, uso
  por laboratorio, franjas de mayor demanda y exportación a Excel.

---

## Reglas de negocio (no romper)

1. **Horarios fijos, no libres**: el estudiante solo reserva en bloques predefinidos
   (`schedule_blocks`), materializados por fecha en `block_sessions`.
2. **Aforo sin sobrecupo**: una reserva `pendiente` o `aprobada` ocupa cupo. El
   control de concurrencia es atómico (bloqueo `FOR UPDATE`) dentro de los RPC.
3. **Materia → Laboratorio**: la materia elegida determina qué labs se habilitan
   (`subject_labs`). El RPC lo revalida en servidor; no confiar solo en la UI.
4. **Ventana de reserva: 4 semanas** (28 días) hacia adelante.
5. **Antelación mínima: 24 horas** antes del inicio del bloque.
6. **Selección múltiple**: hasta **10 franjas** por solicitud, con **tolerancia a
   fallos parciales** — si una se llena mientras el estudiante decide, las demás
   se crean igual y se le informa cuál falló y por qué.
7. **Asistencia desde 30 minutos antes** del inicio (para escanear en la puerta),
   y queda abierta hacia atrás para corregir después.
8. **Cancelación sin penalidad**: no hay sistema de no-shows. Cancelar libera el cupo.
9. **Correos**: al recibir la solicitud y al decidirla. Son *best-effort*: **un fallo
   de correo nunca puede tumbar una reserva**.

Los valores de los puntos 4 a 7 viven en **constantes al inicio de cada función SQL**
(`c_ventana_dias`, `c_antelacion`, `c_max_franjas`) para que cambiarlos sea editar
una línea. Si cambias uno, cámbialo también en la UI (`SEMANAS_MAX` en
`components/publico/calendario-semanal.tsx`).

---

## Base de datos

Esquema base en `supabase/migrations/0001_init.sql`; el resto son incrementos.

### Tablas

| Tabla | Rol |
|---|---|
| `profiles` | Perfiles autenticados (personal). Extiende `auth.users`. |
| `laboratories` | Los ~50 espacios físicos. `code` = slug MAYÚSCULAS sin tildes. |
| `lab_admins` | Asignación laboratorista ↔ lab (N:M). |
| `schedule_blocks` | Bloques fijos recurrentes por día ISO (1=Lun … 7=Dom). |
| `block_sessions` | Instancia de un bloque en una fecha concreta. |
| `reservations` | Una fila = una persona en una sesión. |
| `subjects` | Materias (0009). |
| `subject_labs` | Mapeo materia → laboratorios habilitados (0009). |
| `students` | **Registro canónico del estudiante** (0010). |

### `students` — la identidad canónica (importante)

`student_code` es la **clave natural única** y coincide exactamente con el número
del código de barras del carné. Toda métrica por estudiante debe agrupar por
`students.id`, **nunca por el texto del correo**.

Ojo con los dos nombres parecidos en `reservations`:

- `student_id` → `profiles(id)` — flujo autenticado histórico. Hoy suele ser `NULL`.
- `student_ref` → `students(id)` — flujo público actual. **Este es el bueno para métricas.**

Las columnas `student_name`, `student_email` y `student_code` de `reservations`
se conservan como *foto histórica* de lo que se escribió en el formulario.

### RPCs (toda mutación de reservas pasa por aquí)

**Flujo público (rol `anon` y `authenticated`):**

| RPC | Qué hace |
|---|---|
| `lab_sessions_public(lab_code, from, to)` | Materializa y devuelve las franjas de un lab con cupo y si son reservables. |
| `request_reservations_public(session_ids[], subject_id, nombre, correo, código)` | **El que usa la UI.** Crea varias reservas; tolera fallos parciales. |
| `request_reservation_public(...)` | Versión de una sola franja (0009). Se conserva; la UI ya no la usa. |
| `lookup_reservations_public(código, correo)` | Consulta sin cuenta. Exige ambos datos. |
| `cancel_reservation_public(id, código, correo)` | Cancela sin cuenta. |
| `upsert_student(código, nombre, correo)` | Resuelve/crea el estudiante canónico y normaliza. |
| `ensure_sessions(lab_id, from, to)` | Materializa sesiones (idempotente). |

**Personal (`authenticated`):**

| RPC | Qué hace |
|---|---|
| `decide_reservation(id, approve, reason)` | Aprueba o rechaza. |
| `create_schedule_block(...)` / `deactivate_schedule_block(...)` / `my_admin_labs()` | Gestión de horarios. |
| `attendance_sessions()` | Sesiones con asistencia registrable (desde 30 min antes), con `estado`. |
| `session_attendees(session_id)` | Aprobados de la sesión, con `student_code` para el escáner. |
| `mark_attendance_by_code(session_id, código)` | **Escáner.** Marca a UNO por código de carné. |
| `mark_session_attendance(session_id, ausentes[])` | Cierra el registro de la sesión completa. |
| `student_lab_hours(código, from, to)` | Horas de un estudiante por lab y semestre. |

`cancel_reservation` y `request_reservation` (versiones autenticadas de `0001`)
siguen en la BD pero **ya no se usan** desde la app.

### Vistas

`security_invoker = true` en todas: respetan la RLS de quien consulta.

| Vista | Para qué |
|---|---|
| `v_lab_usage` | Uso agregado por laboratorio. |
| `v_demanda_horaria` | Demanda por lab + día + franja. |
| `v_ocupacion_sesion` | Ocupación por sesión. |
| `v_student_lab_hours` | Una fila por reserva **del flujo público**, con horas y semestre. |
| `v_student_lab_summary` | Agregado por estudiante + lab + semestre. |
| `v_reservas_detalle` | **Fuente del Excel.** Una fila por reserva, TODAS (LEFT JOIN). |
| `v_semestre_resumen` | Agregado por semestre para el dashboard. |

> Diferencia deliberada: `v_student_lab_hours` hace **INNER JOIN** a `students`
> (solo reservas del flujo nuevo), mientras que `v_reservas_detalle` hace **LEFT
> JOIN** para no perder las reservas antiguas en el reporte del jefe.

**Semestre** (convención colombiana): `I` = enero–junio, `II` = julio–diciembre.
Se calcula desde `session_date`, es decir el semestre en que **ocurre** la práctica.

### RLS

Activa en todas las tablas. Helpers: `user_role()`, `is_jefe()`, `is_lab_admin(lab_id)`.

- `anon` puede **leer** el catálogo (`laboratories`, `schedule_blocks`,
  `block_sessions`, `subjects`, `subject_labs`) y **ejecutar** los RPCs públicos.
- `anon` **NO** puede leer `reservations` ni `students` (datos personales). El
  seguimiento pasa por `lookup_reservations_public`.

---

## Índice de migraciones

| # | Qué aporta |
|---|---|
| `0001_init` | Esquema base: tablas, RPCs, RLS, vistas. |
| `0002_grants` | GRANTs de tabla faltantes para `authenticated`. |
| `0003_seed_labs` | Los ~50 laboratorios. |
| `0004_seed_blocks` | Bloques de prueba (METALES, ROBOTICA, AUTOMATIZACION_CONTROL). |
| `0005_fix_decide_reservation` | Cast faltante a `reservation_status`. |
| `0006_schedule_blocks_mgmt` | RPCs de gestión de horarios. |
| `0007_fix_schedule_block_active` | `is_active` (no `active`) y `weekday` ISO. |
| `0008_mark_attendance` | Registro de asistencia (v1: solo tras finalizar). |
| `0009_public_student_flow` | **Materias, mapeo y flujo sin login.** |
| `0010_students_identity` | **Tabla `students` canónica** + métricas por estudiante. |
| `0011_calendar_booking` | Calendario y reserva por lotes (4 semanas, 24 h). |
| `0012_fix_public_grants` | GRANT de `subjects`/`subject_labs` a `authenticated`. |
| `0013_attendance_window` | Asistencia desde 30 min antes + columna `estado`. |
| `0014_scan_attendance` | `mark_attendance_by_code` para el escáner. |
| `0015_dashboard_export` | Vistas del dashboard/Excel + fix de `coalesce` con cadena vacía. |
| `0016_work_groups` | **Grupos de trabajo y puestos** (aforo ≠ equipos). |
| `0017_staff_management` | **Alta y gestión de personal** (registro + pantalla del jefe). |
| `0018_data_consent` | **Autorización de tratamiento de datos** (Ley 1581). |

Se aplican **pegando el archivo completo en el SQL Editor de Supabase**, en orden.
No hay CLI enlazada (`supabase/config.toml` no existe).

---

## El carné estudiantil y el escáner

Hallazgo **verificado** decodificando una foto real del carné con `zxing-cpp`:

- Formato: **CODE 39**
- Contenido: **el código estudiantil tal cual** (ej. `1234567`), el mismo que el
  estudiante escribe al reservar → el cruce es directo, sin tabla puente.
- El número largo del reverso (ej. `1455171579`) es el consecutivo del plástico:
  **no** está en el código de barras y **no** sirve para cruzar.

Por eso el lector se restringe a Code 39 (`DecodeHintType.POSSIBLE_FORMATS`): más
rápido y con menos falsos positivos. Al comparar se normaliza a solo dígitos,
porque Code 39 puede traer los delimitadores `*` y algún lector añade espacios.

**Cada escaneo persiste al instante** (un RPC por lectura). No se acumula en el
navegador: si el celular se apaga a mitad de práctica, lo registrado ya está a salvo.

> ⚠️ **La cámara exige contexto seguro (HTTPS o `localhost`).** Al probar desde el
> celular contra `npm run dev` por IP de red local (`192.168.x.x:3000`), el
> navegador **bloquea** `getUserMedia`. Usa `next dev --experimental-https` o un
> túnel. En Vercel no hay problema. El componente detecta el caso y ofrece
> entrada manual como respaldo.

---

## Correos (Resend) — **operativo desde agosto 2026**

`lib/email/resend.ts` + `lib/email/templates.ts`. Detalle completo en
`DOMINIO-Y-CORREO.md`.

**Dominio de envío:** `labs.innovalaboratories.org` (dominio propio
`innovalaboratories.org` en Cloudflare Registrar), verificado en Resend con DKIM,
SPF y MX. Región São Paulo. Remitente:
`Laboratorios UMNG <laboratorios@labs.innovalaboratories.org>`.

> **Por qué un dominio propio y no el institucional:** la OFITIC no había
> publicado los registros en `unimilitar.edu.co`, y eso bloqueaba el piloto. Es
> **un puente, no el destino**: cuando la UMNG publique los suyos, migrar es
> agregar ese dominio en Resend y cambiar `EMAIL_FROM`. Nada de código.

### Los tres correos

| Momento | Destinatario | Plantilla |
|---|---|---|
| Se crea la solicitud (`pendiente`) | **Solo el laboratorista** del lab | `correoNuevaSolicitud` |
| El laboratorista **aprueba** | El estudiante | `correoPracticaAprobada` |
| El laboratorista **rechaza** | El estudiante, con el motivo | `correoSolicitudRechazada` |

Al crear la solicitud el estudiante **no** recibe nada: ya vio la confirmación en
pantalla. El aviso al laboratorista es el que dispara todo lo demás.

El correo de aprobación incluye las **instrucciones de ingreso propias del
laboratorio** (`laboratories.safety_notes`, editables en `/panel/horarios`), o
las genéricas si no están definidas.

**Son best-effort por diseño**: `enviarCorreo` no lanza excepciones y **reintenta
3 veces** con espera creciente ante fallos transitorios (red, DNS, 429, 5xx),
pero no ante definitivos (clave inválida, dominio sin verificar). Si falta
`RESEND_API_KEY`, omite el envío y lo registra; la reserva sigue siendo válida.
El panel del jefe muestra el estado y permite enviar un correo de prueba.

⚠️ Las plantillas usan **estilos en línea y tablas**, no clases ni variables CSS:
Gmail y Outlook descartan `<style>`. No "modernizar" ese HTML. Y el texto libre
del laboratorista **se escapa** antes de insertarlo (`escapar`): sin eso, un `&`
o un `<` rompen la maqueta del mensaje.

---

## Identidad visual UMNG

Paleta del escudo (variables en `app/globals.css`):

- `--umng-navy #0B254E` — headers, menús
- `--umng-crimson #C41E3A` — **solo** la acción principal / alertas
- `--umng-gold #FDB913` — estado "Pendiente" / detalles
- `--umng-green #2E7D32` — estado "Aprobada" / éxito

Añadido en el rediseño:

- `--umng-sky #2E9BD6` (+ `--umng-sky-50`, `--umng-sky-600`) — **acento
  interactivo**: franjas seleccionables del calendario, foco, escáner.
- `--umng-navy-50 / -100` — superficies suaves del flujo público.
- `--hero-gradient`, `--shadow-card`, `--shadow-pop`.

Clases del sistema: `.hero-umng`, `.card-elevated`, `.field-lg`, `.step-dot`,
`.pick-card`, `.chip`, `.slot` (con `data-state="libre|elegido|lleno|cerrado"`),
`.badge-*` por estado de reserva.

Tipografía: **Libre Franklin** (títulos), **Inter** (cuerpo), **IBM Plex Mono**
(datos: códigos, horas, aforos — clase `.font-data`).

---

## Estructura de carpetas

```
app/
  page.tsx                          landing pública (o redirect por rol)
  (publico)/layout.tsx              cascarón público (barra + enlaces)
  (publico)/reservar/page.tsx       wizard de reserva SIN login
  (publico)/reservar/actions.ts
  (publico)/consulta/page.tsx       seguimiento por código + correo
  (publico)/consulta/actions.ts
  (auth)/login/page.tsx             SOLO personal
  (auth)/actions.ts                 signIn / signOut (signUp retirado)
  (laboratorista)/panel/…           bandeja, asistencia, horarios
  (jefe)/dashboard/page.tsx         métricas
  (jefe)/dashboard/export/route.ts  descarga .xlsx
  auth/callback/route.ts
  globals.css
components/
  publico/reserva-wizard.tsx        wizard de 3 pasos
  publico/calendario-semanal.tsx    grilla L–S / 6:00–19:00
  publico/consulta-reservas.tsx
  panel/barcode-scanner.tsx         cámara + ZXing (Code 39)
  panel/attendance-section.tsx      asistencia manual + escáner
  panel/{request-inbox,decision-buttons,block-form,block-list}.tsx
  dashboard/{lab-usage-table,top-franjas,semestre-resumen}.tsx
  auth/login-form.tsx
lib/
  supabase/{client,server,middleware,roles}.ts
  email/{resend,templates}.ts
  xlsx.ts                           generador .xlsx sin dependencias
proxy.ts                            raíz (convención Next 16, era middleware.ts)
supabase/migrations/                0001 … 0015
```

---

## Variables de entorno (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
RESEND_API_KEY=            # opcional: sin ella se omiten los correos
EMAIL_FROM=                # opcional: "Laboratorios UMNG <...@unimilitar.edu.co>"
```

En producción, `NEXT_PUBLIC_SITE_URL` debe ser la URL pública real, **no** `localhost`.

---

## Trampas conocidas (leer antes de depurar)

Cada una costó una sesión de depuración. Están documentadas también en la
migración que las corrigió.

1. **`GRANT` ≠ RLS, y hay DOS roles.** Supabase usa `anon` sin sesión y
   `authenticated` con sesión. Otorgar solo a uno produce
   `permission denied for table X` (42501) **antes** de evaluar las policies.
   Toda tabla del flujo público va a **ambos**. (`0002`, `0012`)

2. **`coalesce` y la cadena vacía.** `handle_new_user` guarda
   `full_name = coalesce(metadata, '')`, o sea **cadena vacía**, no `NULL`. Un
   `coalesce(a, b, c)` se detiene en ese `''` y deja el nombre en blanco. Usar
   `coalesce(nullif(btrim(x), ''), …)`. (`0015`)

3. **Postgres no cambia el tipo de retorno con `create or replace`.** Si agregas
   una columna a un `RETURNS TABLE`, hay que `DROP FUNCTION` primero — y **volver
   a otorgar el `GRANT`**, que se pierde con el DROP. (`0010`, `0013`)

4. **Zona horaria.** `session_date` (date) + `start_time`/`end_time` (time sin
   zona) son "reloj de pared" de Colombia; el servidor corre en UTC. **Siempre**:
   `(session_date + hora) at time zone 'America/Bogota'` antes de comparar con `now()`.

5. **Fechas en JavaScript.** Nunca `toISOString()` para obtener `YYYY-MM-DD`:
   convierte a UTC y en Colombia devuelve el día anterior. Construir la cadena con
   `getFullYear/getMonth/getDate`. Para parsear, `new Date(iso + "T00:00:00")`.

6. **Tailwind v4 y las capas.** El CSS **sin capa** gana sobre el CSS en capas sin
   importar la especificidad. Las reglas base de `globals.css` van dentro de
   `@layer base`; si no, `h1 { color: navy }` anula un `text-white` y los títulos
   sobre fondo oscuro salen ilegibles.

7. **Reservas anónimas y los JOIN.** `reservations.student_id` es `NULL` en el
   flujo nuevo. Un `INNER JOIN` a `profiles` hace **desaparecer** al estudiante de
   la bandeja y de la asistencia. Usar LEFT JOIN + coalesce (ver trampa 2).

8. **Probar desde el celular: la página carga pero nada responde.** Next.js 16
   bloquea `/_next/*` cuando `next dev` se abre desde un origen distinto de
   `localhost`. Llega el HTML (renderizado en servidor) pero no el JavaScript, así
   que no hidrata: los botones no hacen nada y **no aparece ningún error en
   pantalla**. Solución: listar la IP en `allowedDevOrigins` de `next.config.ts`,
   o añadirla a `DEV_ORIGINS` en `.env.local`. Requiere reiniciar el servidor.
   Solo afecta a desarrollo.

9. **La cámara exige contexto seguro.** Ver la sección del escáner. `localhost`
   sirve; una IP de red por HTTP, no. Para el celular: flag de Chrome
   (`chrome://flags` → "Insecure origins treated as secure") o un túnel HTTPS.
   Si usas túnel, esa URL es **otro origen**: también va en `DEV_ORIGINS`.

10. **La RLS filtra por `lab_admins`.** Un laboratorista solo ve las sesiones de
    los labs que administra. Al sembrar datos de prueba, créalos en un lab
    asignado a la cuenta con la que vas a probar, o no aparecerán. El `jefe` ve
    todo, así que sirve para descartar si algo es permisos o es un error real.

11. **`create or replace view` solo AÑADE columnas al final.** Insertar una
    columna en medio falla con *"cannot change name of view column"*. Si de
    verdad hay que reordenar, toca `DROP VIEW` — y arrastra a las vistas que
    dependan de ella (p. ej. `v_semestre_resumen` depende de
    `v_reservas_detalle`), así que hay que recrearlas todas y volver a otorgar
    los `GRANT`. Casi siempre es más barato poner lo nuevo al final. (`0016`)

---

## Cómo verificar cambios de SQL sin tocar producción

Las migraciones se pueden **reproducir enteras** en un Postgres efímero con
[PGlite](https://pglite.dev) (WASM, sin instalar nada):

```js
import { PGlite } from '@electric-sql/pglite';
const db = await PGlite.create();
// Stubs de lo que aporta Supabase:
await db.exec(`create role anon; create role authenticated; create schema auth;
  create table auth.users(id uuid primary key default gen_random_uuid(),
                          email text, raw_user_meta_data jsonb default '{}');
  create or replace function auth.uid() returns uuid language sql stable
    as $$ select current_setting('test.uid', true)::uuid $$;`);
// Luego aplicar 0001…0015 en orden (quitando `create extension pgcrypto`,
// innecesario porque gen_random_uuid() es nativo desde PG13).
```

Para actuar como un rol concreto: `set test.uid = '<uuid>'` y ajustar
`profiles.role`. Así se probaron el aforo sin sobrecupo, la ventana de 24 h, el
fallo parcial del lote y los casos del escáner.

Para el `.xlsx`, generar el archivo y volver a abrirlo con `openpyxl` en Python
confirma que Excel lo aceptará.

---

## Convenciones

- Comunicación y comentarios en **español**.
- Server Components por defecto; `'use client'` solo cuando haga falta interactividad.
- **Toda mutación de reservas pasa por RPCs `SECURITY DEFINER`.** No hacer
  INSERT/UPDATE directo a `reservations`.
- No exponer datos personales en URLs. Respetar RLS: nunca filtrar en el cliente
  lo que debe filtrar la base de datos.
- No introducir lógica de inventario/préstamo de equipos.
- `code` de laboratorio: slug en MAYÚSCULAS sin tildes, sin el prefijo
  "LABORATORIO" (p. ej. `METALES`, `AUTOMATIZACION_CONTROL`).

---

## Estado actual

**Funcionando y verificado end-to-end:**

- **Flujo público del estudiante**: wizard de 3 pasos en `/reservar` (identidad →
  materia/lab → calendario), reserva múltiple, pantalla de confirmación con detalle
  de fallos parciales, y seguimiento/cancelación en `/consulta`.
- **Calendario semanal** con cupo en vivo, franjas no reservables atenuadas y
  navegación de 4 semanas.
- **Panel del laboratorista**: bandeja de solicitudes (aprobar/rechazar con motivo),
  gestión de bloques horarios y registro de asistencia con insignias de estado.
- **Escáner de carné** Code 39 con cámara trasera, antirrebote, realimentación
  sonora/vibración y entrada manual de respaldo.
- **Dashboard del jefe**: tarjetas resumen, prácticas por semestre con histórico,
  uso por laboratorio, franjas más demandadas y **exportación a Excel** (17 columnas).
- **Correos operativos**: dominio propio `labs.innovalaboratories.org` verificado
  en Resend, clave configurada y envío confirmado a destinatarios externos.
- Infraestructura migrada a cuentas institucionales (GitHub + Supabase).

**Deuda técnica conocida:**

- **DMARC pendiente**: falta publicar `_dmarc.labs` en Cloudflare con
  `v=DMARC1; p=none; rua=mailto:...`. No bloquea el envío, pero mejora la
  reputación. Verificado por consulta al DNS: hoy no existe.
- **Dominio no institucional**: los correos salen de `innovalaboratories.org`,
  registrado a título personal. Renovación automática activa, pero es una
  dependencia de una persona — el mismo riesgo que se corrigió al migrar GitHub y
  Supabase a la organización. Migrar al dominio de la UMNG cuando la OFITIC
  publique los registros.
- **Revisión jurídica de la política**: `/politica-datos` es un borrador técnico
  que cubre lo que exige el Decreto 1377, pero **debe aprobarlo el área de
  protección de datos de la UMNG**, y falta inscribir la base en el RNBD si aplica.
  También hay que confirmar el correo de contacto en `lib/politica-datos.ts`.
- **Recuperación de contraseña**: no hay pantalla. Si un laboratorista olvida la
  suya, se resuelve por SQL (`update auth.users set encrypted_password = crypt(...)`).
- **Materias**: solo hay 3 sembradas (Automatización, Procesos de mecanizado,
  Tecnología mecánica). Falta cargar el resto y una UI para que el jefe las
  administre; hoy se añaden por SQL.
- **`CIM` sin bloques horarios**: aparece habilitado para Automatización pero su
  calendario sale vacío hasta que su laboratorista publique franjas.
- Al desactivar un bloque solo se marca `is_active = false`; las sesiones futuras
  ya materializadas no se limpian. Falta decidir la política.
- Faltan los tipos de la BD (`lib/types/database.types.ts` con
  `supabase gen types typescript`); hoy se tipan las consultas a mano con casts.
- **Rol `estudiante` legado**: los perfiles antiguos siguen en `profiles` y pueden
  iniciar sesión (van a `/reservar`). Decidir si se depuran.
- **Vercel sin desplegar**; **API keys `anon` legacy** (Supabase las deprecia a
  fin de 2026 a favor de `publishable`/`secret`); **anti-pausa del plan Free**.

---

## Próximo paso sugerido

**Producto:** cargar el catálogo real de materias y su mapeo a laboratorios (hoy
solo hay 3 de ejemplo) — es lo que más limita una prueba con estudiantes reales.
Después: UI para que el jefe gestione materias y `lab_admins`, y generar los tipos
de la BD.

**Institucional / despliegue:** habeas data en el formulario, confirmar el modelo
de gobernanza con jefatura, contactos de la OFITIC, cumplimiento de la Ley 1581 y
y retomar la solicitud a la OFITIC para migrar al dominio institucional.
Recién entonces, montar Vercel. Considerar un
piloto controlado (p. ej. Metales y CIM) antes del despliegue total.
