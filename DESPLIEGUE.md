# Guía de despliegue — Plataforma de Reserva de Laboratorios UMNG

Procedimiento para publicar la plataforma en Vercel y dejarla lista para el
piloto. Pensada para seguirse de arriba abajo la primera vez, y como referencia
de operación después.

> **Antes de empezar**, asegúrate de que el proyecto de Supabase esté activo. En
> el plan Free se pausa tras 7 días de inactividad: si el panel muestra
> *"Project paused"*, dale **Resume project** y espera un par de minutos.

---

## 1. Verificación previa (en tu máquina)

```bash
npm install     # asegura que node_modules coincida con package.json
npm run build   # ⚠️ debe terminar sin errores
```

**Si `npm run build` falla, no sigas.** Vercel ejecuta exactamente ese comando y
fallará igual, pero con menos información en pantalla. Los fallos típicos son
errores de ESLint que en desarrollo solo salían como advertencia.

---

## 2. Migraciones de base de datos

Se aplican **en orden**, copiando cada archivo completo en el **SQL Editor** de
Supabase. No hay CLI enlazada en este proyecto.

Estado esperado antes de desplegar: de la `0001` a la `0021` aplicadas.

Comprobación rápida de que están todas:

```sql
select
  (select count(*) from information_schema.tables
    where table_schema='public'
      and table_name in ('subjects','subject_labs','students'))            as tablas_nuevas,       -- 3
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='reservations'
      and column_name in ('group_id','consent_version','student_ref'))      as columnas_clave,      -- 3
  (select count(*) from information_schema.routines
    where routine_schema='public'
      and routine_name in ('request_group_reservations_public',
                           'mark_attendance_by_code','list_staff'))         as rpcs_clave,          -- 3
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='programs')                  as carreras,            -- 1
  (select count(*) from information_schema.routines
    where routine_schema='public'
      and routine_name='reservation_notification_targets')                  as aviso_laboratorista; -- 1
```

Los tres primeros deben dar **3**; los dos últimos, **1**.

---

## 3. Ajustes en Supabase

**Authentication → Providers → Email**

- **Desactiva "Confirm email"**. Si queda activo, cada laboratorista debe
  confirmar por correo, y el servicio de correo del plan Free permite solo dos o
  tres envíos por hora: con varios registros el mismo día, se traba.
  Es seguro desactivarlo porque **la aprobación del jefe es el filtro real**: la
  cuenta no da acceso a nada hasta que se le asigne rol y laboratorios.

**Authentication → URL Configuration**

- **Site URL**: la URL pública de Vercel (por ejemplo
  `https://paginadivlab.vercel.app`).
- **Redirect URLs**: agrega `https://<tu-dominio>/auth/callback`.

---

## 4. Desplegar en Vercel

1. Entra a [vercel.com](https://vercel.com) con la cuenta institucional y elige
   **Add New → Project**.
2. Importa el repositorio `divlab-umng/paginadivlab`.
3. Framework: **Next.js** (lo detecta solo). No cambies el comando de build.
4. En **Environment Variables**, agrega:

| Variable | Valor | Obligatoria |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | La misma de `.env.local` | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La misma de `.env.local` | Sí |
| `NEXT_PUBLIC_SITE_URL` | La URL pública de Vercel | Sí |
| `RESEND_API_KEY` | Clave de Resend | Para los correos — ver `CORREOS.md` |
| `EMAIL_FROM` | `Laboratorios UMNG <laboratorios@labs.innovalaboratories.org>` | Recomendada |

> **`RESEND_API_KEY` solo en *Production*.** Si la dejas también en Preview, cada
> rama que despliegues puede mandar correos reales a estudiantes reales.

> **`EMAIL_FROM` es opcional pero conviene definirla.** El código ya trae por
> defecto el dominio verificado `labs.innovalaboratories.org`, así que funciona
> aunque se olvide. Definirla explícitamente evita sorpresas el día que se migre
> al dominio institucional: ahí basta cambiar la variable, sin tocar código.
> El procedimiento completo está en `DOMINIO-Y-CORREO.md`.

> **`NEXT_PUBLIC_SITE_URL` es la que más se olvida.** Si queda en `localhost`,
> los enlaces de los correos apuntan al computador de quien desarrolló.
> Las variables `NEXT_PUBLIC_*` se incrustan en el build: si cambias una,
> hay que **volver a desplegar** para que tenga efecto.

5. **Deploy**. El primer despliegue tarda unos minutos.

`DEV_ORIGINS` y `allowedDevOrigins` **no se configuran en Vercel**: solo afectan
al servidor de desarrollo.

---

## 5. Keep-alive (evita que Supabase se pause)

El repositorio incluye `.github/workflows/keep-alive.yml`. Para activarlo, en
GitHub → **Settings → Secrets and variables → Actions**:

- `SUPABASE_URL` = la misma URL de Supabase
- `SUPABASE_ANON_KEY` = la misma clave anon

Luego ve a la pestaña **Actions**, elige *Keep-alive Supabase* y ejecútalo a mano
una vez con **Run workflow** para comprobar que responde `HTTP 200`.

---

## 6. Verificación posterior al despliegue

Recorre esto en la URL pública, idealmente desde el celular:

- [ ] La portada carga y el título se ve **blanco** sobre el azul.
- [ ] **Reservar laboratorio** → el formulario valida el correo institucional.
- [ ] La casilla de **autorización de datos** bloquea el botón hasta marcarla, y
      el enlace a la política abre.
- [ ] Al elegir materia se habilitan solo sus laboratorios.
- [ ] El calendario carga franjas y respeta las 24 horas de anticipación.
- [ ] Se puede completar una reserva y aparece la pantalla de confirmación.
- [ ] **/consulta** encuentra esa reserva con código + correo y permite cancelarla.
- [ ] **/registro-personal** permite registrarse, y esa cuenta **no** puede entrar.
- [ ] Con la cuenta de jefe: **/dashboard → Personal** muestra la solicitud y
      permite asignar rol y laboratorios.
- [ ] **/panel** con un laboratorista muestra solo sus laboratorios.
- [ ] El **escáner de carné** abre la cámara (en Vercel ya es HTTPS, funciona sin
      configurar nada).
- [ ] **/dashboard → Exportar a Excel** descarga el archivo y abre en Excel.
- [ ] En **/dashboard**, el recuadro **"Envío de correos"** y el botón
      **Enviar prueba** confirman que Resend responde.
- [ ] Al crear una reserva, al laboratorista del laboratorio le llega el aviso
      de solicitud nueva (requiere dominio verificado; ver `CORREOS.md`).

---

## 7. Configurar los laboratorios del piloto

Cada laboratorista, desde `/panel/horarios`, define sus propios bloques:
día, hora de inicio y fin, **aforo** y —donde aplique— **puestos de trabajo** y
**tamaño máximo de grupo**.

Antes de eso, el jefe debe cargar en la base:

- Las **materias** y su mapeo a laboratorios (`subjects`, `subject_labs`). Hoy
  solo hay tres de ejemplo: sin la materia correspondiente, un estudiante no
  puede reservar.
- La asignación **laboratorista ↔ laboratorio**, desde `/dashboard/personal`.

---

## 8. Si algo sale mal

**Código:** en Vercel → pestaña **Deployments** → despliegue anterior →
**Promote to Production**. Vuelve a la versión previa en segundos.

**Base de datos:** no hay rollback automático. Por eso las migraciones son
aditivas y **una migración ya aplicada nunca se edita**: si algo está mal, se
corrige con una migración nueva. Antes de cualquier cambio que toque datos
existentes, exporta desde el panel de Supabase.

---

## 9. Operación del día a día

- **Cambios de código**: `git push` a `main` y Vercel despliega solo. Cada rama
  recibe además una URL de *preview* para probar antes de mezclar.
- **Cambios de datos** (horarios, aforos, puestos, materias, asignaciones): se
  hacen desde el panel o por SQL. **No requieren desplegar nada.**
- **Cuentas nuevas de personal**: se registran en `/registro-personal` y el jefe
  las habilita en `/dashboard/personal`.

---

## Pendientes conocidos antes del uso masivo

- **Revisión jurídica** de `/politica-datos` por el área de protección de datos
  de la UMNG, e inscripción de la base en el **RNBD** de la SIC si aplica.
- **Dominio verificado en Resend** para que salgan los correos desde una
  dirección institucional.
- **Recuperación de contraseña**: todavía no hay pantalla; hoy se resuelve por
  SQL desde Supabase.
- **Subir a Supabase Pro** cuando haya tráfico real, para no depender del
  keep-alive y tener respaldos automáticos.
