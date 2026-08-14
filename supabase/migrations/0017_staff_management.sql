-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0017_staff_management.sql — alta y gestión del PERSONAL
-- ----------------------------------------------------------------------------
-- EL HUECO QUE TAPA
--   Al retirar el registro de estudiantes (rediseño de agosto 2026) se eliminó
--   `signUp` por completo. Resultado: un laboratorista no tenía forma de obtener
--   cuenta. Había que crearla a mano en Supabase, cambiar el rol por SQL y
--   asignar los laboratorios por SQL. Inviable para un despliegue real.
--
-- EL FLUJO
--   1. El laboratorista se registra en /registro-personal con su correo
--      institucional. Su perfil nace con rol `estudiante`, que en la práctica
--      significa SIN PERMISOS: no accede ni a /panel ni a /dashboard.
--   2. Queda marcado con `staff_requested_at`, y el jefe lo ve en su pantalla
--      de personal.
--   3. El jefe le asigna el rol de laboratorista y marca sus laboratorios.
--      Hasta ese momento la cuenta existe pero no puede hacer nada.
--
-- POR QUÉ NO SE AGREGÓ UN ROL 'pendiente' AL ENUM
--   `alter type ... add value` no puede ejecutarse dentro de un bloque de
--   transacción, y el SQL Editor de Supabase envuelve el script. Una columna
--   de marca evita ese problema y además deja registro de CUÁNDO se solicitó.
--
-- Idempotente.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. Marca de solicitud de acceso
-- ============================================================================
alter table public.profiles
  add column if not exists staff_requested_at timestamptz;

comment on column public.profiles.staff_requested_at is
  'Cuándo pidió acceso como personal. No nulo + rol estudiante = pendiente de aprobación.';

-- ============================================================================
-- 2. handle_new_user(): registra la solicitud si viene en los metadatos
-- ----------------------------------------------------------------------------
-- Se conserva la validación de dominio institucional en la base de datos, que
-- es la capa que no se puede saltar desde el cliente.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.email !~* '@unimilitar\.edu\.co$' then
    raise exception 'Solo se permite el registro con correo institucional @unimilitar.edu.co';
  end if;

  insert into public.profiles (id, email, full_name, role, staff_requested_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'estudiante',   -- sin permisos; el jefe promueve manualmente
    case when (new.raw_user_meta_data ->> 'staff_request') = 'true'
         then now() else null end
  );
  return new;
end;
$$;

-- ============================================================================
-- 3. Listado de personal (solo jefe)
-- ----------------------------------------------------------------------------
-- Devuelve tanto a los pendientes como al personal activo, con los códigos de
-- los laboratorios que administra cada uno.
-- ============================================================================
create or replace function public.list_staff()
returns table (
  user_id            uuid,
  email              text,
  full_name          text,
  role               public.user_role,
  staff_requested_at timestamptz,
  created_at         timestamptz,
  lab_ids            uuid[],
  lab_codes          text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.email,
         nullif(btrim(p.full_name), ''),
         p.role,
         p.staff_requested_at,
         p.created_at,
         coalesce(array_agg(l.id   order by l.name) filter (where l.id is not null), '{}'),
         coalesce(array_agg(l.code order by l.name) filter (where l.id is not null), '{}')
    from public.profiles p
    left join public.lab_admins   la on la.admin_id = p.id
    left join public.laboratories l  on l.id = la.lab_id
   where public.is_jefe()          -- sin esto, devuelve vacío para cualquier otro rol
   group by p.id, p.email, p.full_name, p.role, p.staff_requested_at, p.created_at
   order by (p.staff_requested_at is not null and p.role = 'estudiante') desc,  -- pendientes primero
            p.created_at desc;
$$;

grant execute on function public.list_staff() to authenticated;

-- ============================================================================
-- 4. Cambiar el rol de una cuenta (solo jefe)
-- ----------------------------------------------------------------------------
-- GUARDA IMPORTANTE: el jefe no puede cambiar su PROPIO rol. Sin esa
-- restricción bastaría un clic para quedarse sin acceso de administración y
-- sin forma de recuperarlo desde la interfaz.
-- ============================================================================
create or replace function public.set_user_role(
  p_user_id uuid,
  p_role    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if not public.is_jefe() then
    raise exception 'Solo el jefe puede cambiar roles';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'No puedes cambiar tu propio rol';
  end if;
  if p_role not in ('estudiante', 'laboratorista', 'jefe') then
    raise exception 'Rol inválido';
  end if;

  v_role := p_role::public.user_role;

  update public.profiles
     set role = v_role
   where id = p_user_id;

  if not found then
    raise exception 'Cuenta no encontrada';
  end if;

  -- Si deja de ser laboratorista, pierde las asignaciones de laboratorio.
  if v_role <> 'laboratorista' then
    delete from public.lab_admins where admin_id = p_user_id;
  end if;
end;
$$;

grant execute on function public.set_user_role(uuid, text) to authenticated;

-- ============================================================================
-- 5. Asignar los laboratorios de un laboratorista (solo jefe)
-- ----------------------------------------------------------------------------
-- Reemplaza la lista completa: lo que no venga en p_lab_ids se desasigna.
-- Es más simple de razonar que agregar/quitar de a uno desde la interfaz.
-- ============================================================================
create or replace function public.set_lab_admins(
  p_admin_id uuid,
  p_lab_ids  uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  public.user_role;
  v_ids   uuid[] := coalesce(p_lab_ids, '{}'::uuid[]);
  v_count integer;
begin
  if not public.is_jefe() then
    raise exception 'Solo el jefe puede asignar laboratorios';
  end if;

  select role into v_role from public.profiles where id = p_admin_id;
  if v_role is null then
    raise exception 'Cuenta no encontrada';
  end if;
  if v_role <> 'laboratorista' then
    raise exception 'Primero asigna el rol de laboratorista a esta cuenta';
  end if;

  -- Fuera las que ya no correspondan.
  delete from public.lab_admins
   where admin_id = p_admin_id
     and not (lab_id = any (v_ids));

  -- Dentro las nuevas (las repetidas no molestan por el unique).
  insert into public.lab_admins (lab_id, admin_id)
  select x, p_admin_id from unnest(v_ids) as t(x)
  on conflict (lab_id, admin_id) do nothing;

  select count(*) into v_count from public.lab_admins where admin_id = p_admin_id;
  return v_count;
end;
$$;

grant execute on function public.set_lab_admins(uuid, uuid[]) to authenticated;

-- ============================================================================
-- 6. Catálogo de laboratorios para el selector del jefe
-- ============================================================================
create or replace function public.list_labs_for_admin()
returns table (id uuid, code text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.code, l.name
    from public.laboratories l
   where public.is_jefe() and l.is_active
   order by l.name;
$$;

grant execute on function public.list_labs_for_admin() to authenticated;

-- ============================================================================
-- VERIFICACIÓN SUGERIDA (como jefe)
-- ----------------------------------------------------------------------------
--   select email, role, staff_requested_at, lab_codes from public.list_staff();
--
-- Aprobar a alguien:
--   select public.set_user_role('<uuid>', 'laboratorista');
--   select public.set_lab_admins('<uuid>', array[
--     (select id from public.laboratories where code = 'METALES')
--   ]);
-- ============================================================================
