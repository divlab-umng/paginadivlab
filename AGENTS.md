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
- **Vercel**: **desplegado desde agosto de 2026** en plan Hobby. Ver la sección
  *Despliegue en producción*. La cuenta está a nombre personal
  (`ingvargas081801@gmail.com`) con el correo institucional como secundario: es
  la última pieza de infraestructura que falta pasar a la organización.

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
| `programs` | Carreras (0019). `code` = slug MAYÚSCULAS sin tildes. |
| `subject_programs` | Mapeo materia → carreras (0019). |
| `reservation_notification_targets` | *Función*, no tabla: a quién avisar (0021). |

### La cascada carrera → materia → laboratorio (0019)

El estudiante elige en tres pasos, y cada uno filtra al siguiente. Se apoya en
**dos N:M independientes**, no en una jerarquía:

```
programs ──subject_programs──> subjects ──subject_labs──> laboratories
```

Esa independencia es la que resuelve los casos reales:

- **Biomédica** está autorizada en Metales y CIM pero no aporta materias propias:
  ve las mismas de esas carreras. Una jerarquía rígida no lo permitiría.
- **Mecánica de Fluidos** (Ambiental) y **Mecánica de Fluidos y Tuberías**
  (Civil) comparten el Cubo de Práctica, pero cada estudiante solo ve la suya.
- Una materia puede darse en varios laboratorios y un laboratorio servir a varias
  carreras, sin duplicar filas.

`reservations.program_id` guarda con qué carrera reservó cada quien: es lo que
permite después cruzar demanda por programa académico.

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
| `0019_programs_cascade` | **Carreras** (`programs`, `subject_programs`) → cascada de 3 niveles. |
| `0020_seed_piloto` | Datos del piloto: 4 carreras, 9 materias, horarios de Metales, CIM y Diseño. |
| `0021_notification_targets` | `reservation_notification_targets`: a quién avisar de cada solicitud. |
| `0022_lab_safety_notes` | `laboratories.safety_notes`: instrucciones de ingreso por lab. |
| `0023_fix_block_deletion` | **Franja eliminada seguía en el calendario** + el borrado ahora protege reservas. |
| `0024_materiales_civil` | Laboratorio de Materiales: Ing. Civil, 6 materias y malla L–V 8:00–17:00. |
| `0025_cubo_practica` | Cubo de Práctica: Ing. Ambiental, hidráulica y fluidos. |

Se aplican **pegando el archivo completo en el SQL Editor de Supabase**, en orden.
No hay CLI enlazada (`supabase/config.toml` no existe).

> **No hay registro de qué migración corrió.** Supabase no lo lleva y aquí no se
> usa la CLI. Para saber el estado real, `supabase/pruebas/diagnostico_migraciones.sql`
> le pregunta al catálogo si existe cada objeto que cada migración debía crear.
> Es la única fuente de verdad disponible.

> **Corregir una migración ya aplicada es válido si es idempotente.** Todas las
> de 0016 en adelante lo son (`create or replace`, `if not exists`,
> `on conflict`), así que ante un error se arregla el archivo y se vuelve a
> pegar, en vez de acumular migraciones-parche. No aplica a `drop … cascade`,
> `add column` sin `if not exists` ni inserts sin `on conflict`.

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
  panel/{group-policy-form,safety-notes-form}.tsx
  panel/barra-sesion.tsx            nav común: vista pública + cerrar sesión
  dashboard/{lab-usage-table,top-franjas,semestre-resumen}.tsx
  dashboard/{estado-correo,staff-manager}.tsx
  dashboard/{grafica-estados,grafica-demanda}.tsx   SVG a mano, sin librería
  auth/{login-form,staff-register-form}.tsx
lib/
  supabase/{client,server,middleware,roles}.ts
  email/{resend,templates}.ts
  xlsx.ts                           generador .xlsx sin dependencias
  politica-datos.ts                 versión, responsable y texto del consentimiento
proxy.ts                            raíz (convención Next 16, era middleware.ts)
supabase/migrations/                0001 … 0025
supabase/pruebas/                   scripts de diagnóstico (NO son migraciones)
  diagnostico_migraciones.sql       qué migraciones están realmente aplicadas
  diagnostico_correos.sql           por qué un laboratorista no recibe avisos
  sesion_de_prueba.sql              sesión inminente para probar el escáner
.github/workflows/keep-alive.yml    evita que Supabase pause el proyecto Free
```

**Las gráficas del dashboard son SVG escrito a mano, no una librería.** El
proyecto no tiene Chart.js ni Recharts: traer una entera para un anillo de
cuatro tramos costaría ~150 KB de JavaScript. Un `circle` con `stroke-dasharray`
hace lo mismo con cero dependencias. Además son **componentes de servidor** (sin
`'use client'`), así que llegan como HTML. Se alimentan de `v_lab_usage`, que el
dashboard ya consultaba: **no añaden ni una consulta**.

---

## Variables de entorno (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
RESEND_API_KEY=            # opcional: sin ella se omiten los correos
EMAIL_FROM=                # opcional: por defecto ya usa el dominio verificado
DEV_ORIGINS=               # opcional: IPs extra para probar desde el celular
```

**En Vercel (Production) los valores son otros:**

| Variable | Valor | Entornos |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://labs.innovalaboratories.org` | Production + Preview |
| `EMAIL_FROM` | `Laboratorios UMNG <laboratorios@labs.innovalaboratories.org>` | Production + Preview |
| `RESEND_API_KEY` | clave `paginadivlab-prod` | **solo Production** |

`RESEND_API_KEY` se restringe a Production a propósito: si estuviera también en
Preview, cualquier rama desplegada podría mandar correos reales a estudiantes
reales — y Preview usa **la misma base de datos** que producción.

Dos detalles que rompen cosas en silencio:

- **`NEXT_PUBLIC_SITE_URL` sin barra final.** El código concatena
  `${NEXT_PUBLIC_SITE_URL}/auth/callback`; con barra quedaría `//auth/callback`.
- **Las `NEXT_PUBLIC_*` se incrustan en el build.** Cambiarlas exige
  **redesplegar**; guardar el valor nuevo no basta.

---

## Despliegue en producción

**En línea desde agosto de 2026.** Guía completa en `DESPLIEGUE.md`.

| | |
|---|---|
| **URL principal** | `https://labs.innovalaboratories.org` |
| **URL alterna** | `https://paginadivlab.vercel.app` (sigue activa, no romper) |
| Proyecto Vercel | `paginadivlab`, plan Hobby, entorno Production sobre `main` |
| Repositorio | `divlab-umng/paginadivlab`, **público** |

> **El repositorio es público a propósito.** El plan Hobby de Vercel **no
> despliega repositorios privados que pertenezcan a una organización de GitHub**.
> Las alternativas eran pagar Pro (~20 USD/mes) o hacerlo público. Antes de
> publicarlo se auditó todo el historial: cero claves, ningún `.env` commiteado
> jamás, y se retiró un código de carné real que figuraba como ejemplo.
> Los términos del plan Hobby restringen a uso personal no comercial, y una
> plataforma institucional está en zona gris — es una razón más para migrar a
> una cuenta institucional.

**El dominio de la app y el del remitente son el mismo a propósito.** Antes la
app vivía en `paginadivlab.vercel.app` y los correos salían de
`labs.innovalaboratories.org`: para un filtro de correo eso son tres identidades
en un mismo mensaje (dice ser de la universidad, viene de un dominio
desconocido, enlaza a un tercero) — la firma clásica del phishing. Resend lo
señalaba en *Insights* como **"Ensure link URLs match sending domain"**.

En Cloudflare, `labs` es un **CNAME a Vercel en modo DNS only** (nube gris). Si
se proxia, Vercel no puede validar el dominio ni emitir el certificado.
Verificado tras el cambio: los cuatro registros de correo que cuelgan de `labs`
(`send.labs`, `resend._domainkey.labs`, `_dmarc.labs`, `links.labs`) siguen
resolviendo — un CNAME solo afecta a su propio nodo, no a sus hijos.

**Qué exige un redespliegue y qué no:**

| Cambio | ¿Redesplegar? |
|---|---|
| Horarios, laboratoristas, materias, aforo, instrucciones | **No.** Viven en Supabase, surten efecto al instante. |
| Migraciones SQL | **No**, pero aplícalas **antes** de mezclar el código que las usa. |
| Cualquier variable `NEXT_PUBLIC_*` | **Sí**, siempre. Se incrustan en el build. |
| Código | Sí — `git push origin main` lo dispara solo. |

> **Preview no es un entorno aislado: usa la MISMA base de datos que
> producción.** Lo que reserves probando en una rama son filas reales. Lo único
> que sí está separado es el correo, porque `RESEND_API_KEY` solo existe en
> Production.

**En Supabase → Authentication → URL Configuration** deben estar las tres
Redirect URLs: la del dominio propio, la de `vercel.app` y `localhost:3000`. Es
una lista blanca: quitar una deja fuera a quien tenga guardado ese enlace.
*Confirm email* está **desactivado**; el filtro real es la aprobación del jefe.

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

3-bis. **`create or replace function` valida la sintaxis, NO que los alias
   existan.** Una función puede instalarse sin una sola queja y reventar al
   primer llamado. Pasó de verdad: al reescribir `lab_sessions_public` para
   añadirle un `join`, se **sustituyó** la línea del
   `cross join lateral session_occupancy(bs.id) o` en vez de conservarla,
   mientras el `select` seguía usando `o.puestos`. La migración se aplicó en
   verde y el calendario de **todos** los laboratorios murió con
   `missing FROM-clause entry for table "o"`.

   Ni el build de Next.js ni el typecheck miran dentro de una función de
   Postgres: TypeScript no valida SQL. Dos reglas que salen de ahí:

   - Al reescribir una función completa, **diferénciala contra la versión
     anterior** antes de darla por buena. Añadir no es sustituir.
   - La verificación de una migración debe **invocar** la función, no mirar el
     catálogo. Que exista no prueba que corra. (`0023`)

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

8. **`profiles.role` es un enum (`user_role`), no texto.** Cualquier `coalesce`
   o concatenación contra una cadena suelta hay que hacerlo sobre `p.role::text`,
   o Postgres intenta convertir esa cadena a un valor válido del enum y aborta
   con `invalid input value for enum user_role`. Consecuencia de fondo: un
   laboratorista mal configurado **no** tiene un rol raro — tiene uno de los tres
   válidos que no es el que hace falta, y eso no se ve a simple vista.

9. **"Delivered" en Resend no significa "en la bandeja de entrada".** Significa
   que el servidor del destinatario aceptó el mensaje (`250 OK`). Lo que pase
   después —bandeja, spam o cuarentena— lo decide `unimilitar.edu.co` y no deja
   rastro en Resend. Si un laboratorista dice que no le llegó y Resend marca
   *Delivered*, el problema está **dentro** de la universidad: revisar la
   cuarentena de Microsoft 365 (`security.microsoft.com/quarantine`), que es
   distinta de la carpeta de correo no deseado.

   La gestión más liviana con la OFITIC no es delegar DNS sino pedir que
   `labs.innovalaboratories.org` entre en la lista de remitentes permitidos del
   filtro institucional. Es una entrada en Exchange, cosa de minutos.

10. **Probar desde el celular: la página carga pero nada responde.** Next.js 16
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
- **Dashboard del jefe**: tarjetas resumen, **gráfica de demanda por laboratorio**
  y **dona de estados** (SVG propio, sin librería y sin consultas extra), prácticas
  por semestre con histórico, uso por laboratorio, franjas más demandadas,
  gestión de personal y **exportación a Excel** (17 columnas).
- **Cerrar sesión y vista pública** en ambos paneles (`components/panel/barra-sesion.tsx`).
- **Correos operativos**: `labs.innovalaboratories.org` verificado en Resend con
  **SPF, DKIM y DMARC publicados** y entregas confirmadas a destinatarios externos.
- **Desplegado en Vercel** sobre el mismo dominio del remitente.
- **Cascada de 3 niveles** carrera → materia → laboratorio, con 6 carreras y
  24 materias sembradas.
- Infraestructura migrada a cuentas institucionales (GitHub + Supabase).

**Deuda técnica conocida:**

- **Dominio no institucional**: `innovalaboratories.org` está registrado a título
  personal. Renovación automática activa, pero depende de una persona — el mismo
  riesgo que se corrigió al migrar GitHub y Supabase a la organización.
- **Cuenta de Vercel personal**, con el correo institucional solo como
  secundario. Es la última pieza sin pasar a la organización.
- **Los correos llegan a cuarentena en `unimilitar.edu.co`.** Resend los marca
  *Delivered* y el filtro institucional los retiene: dominio de semanas, sin
  reputación. Ver la trampa 9. Camino corto: pedir a la OFITIC que lo agregue a
  remitentes permitidos. Camino de fondo: migrar al dominio institucional.
- **Revisión jurídica de la política**: `/politica-datos` (versión 1.1) nombra al
  responsable en genérico y **debe aprobarlo el área de protección de datos**.
  Falta confirmar que el buzón de habeas data en `lib/politica-datos.ts` exista y
  lo atienda alguien, e inscribir la base en el RNBD si aplica.
- **Recuperación de contraseña**: no hay pantalla. Si un laboratorista olvida la
  suya, se resuelve por SQL (`update auth.users set encrypted_password = crypt(...)`).
- **No hay UI para gestionar materias ni carreras**: se añaden por migración. El
  jefe sí puede gestionar personal y `lab_admins` desde `/dashboard/personal`.
- **Laboratorios del piloto sin horario**: Física, Química y el Cubo de Práctica
  tienen oferta académica pero **ningún bloque publicado**, así que su calendario
  sale vacío. Se resuelve desde `/panel/horarios`, no por SQL.
- **Keep-alive sin activar**: falta agregar `SUPABASE_URL` y `SUPABASE_ANON_KEY`
  como secretos en GitHub Actions y ejecutar el workflow una vez a mano.
- Faltan los tipos de la BD (`lib/types/database.types.ts` con
  `supabase gen types typescript`); hoy se tipan las consultas a mano con casts.
- **Rol `estudiante` legado**: los perfiles antiguos siguen en `profiles` y pueden
  iniciar sesión (van a `/reservar`). Decidir si se depuran.
- **API keys `anon` legacy** (Supabase las deprecia a fin de 2026 a favor de
  `publishable`/`secret`).

---

## Próximo paso sugerido

**Operativo (lo que bloquea el piloto hoy):** que cada laboratorio con oferta
académica tenga **laboratorista asignado y bloques publicados**. Sin bloques el
estudiante llega al calendario y lo ve vacío; sin laboratorista asignado nadie
recibe los avisos. `supabase/pruebas/diagnostico_correos.sql` dice cuáles están
a medio configurar.

**Entregabilidad:** pedir a la OFITIC que agregue `labs.innovalaboratories.org` a
los remitentes permitidos del filtro institucional. Es una gestión mucho más
liviana que delegar DNS y resuelve el problema de inmediato.

**Producto:** UI para que el jefe gestione materias y carreras (hoy solo por
migración), pantalla de recuperación de contraseña, y generar los tipos de la BD.

**Institucional:** aprobación de la política por protección de datos, pasar la
cuenta de Vercel a la organización, y retomar la solicitud a la OFITIC para
migrar al dominio institucional — con lo que además desaparecería el problema de
cuarentena.
