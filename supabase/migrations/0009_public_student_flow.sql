-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0009_public_student_flow.sql — FASE 1 del rediseño
-- ----------------------------------------------------------------------------
-- Objetivo: habilitar el flujo del estudiante SIN login.
--   1) Materias (subjects) + mapeo Materia→Laboratorio (subject_labs).
--   2) Guardar la identidad del estudiante EN la reserva (sin auth.users).
--   3) RPCs públicos (rol `anon`) para solicitar, consultar y cancelar,
--      conservando el control de aforo atómico (FOR UPDATE, sin sobrecupo).
--   4) RLS + GRANTs mínimos para que el rol `anon` lea el catálogo y ejecute
--      solo los RPCs necesarios.
--
-- Diseño de seguridad:
--   - El estudiante NO se autentica. Las reservas anónimas guardan
--     student_name/student_email/student_code y NO tienen student_id.
--   - Los estudiantes no pueden SELECT directo a `reservations` (privacidad):
--     el seguimiento se hace por RPC filtrando por código + correo.
--   - Toda mutación de reservas sigue pasando por RPCs SECURITY DEFINER.
--
-- Idempotente: usa IF NOT EXISTS / on conflict do nothing / create or replace.
-- Aplicar en el SQL Editor de Supabase o con la CLI.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. MATERIAS y mapeo Materia → Laboratorio (N:M)
-- ============================================================================

create table if not exists public.subjects (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,          -- slug MAYÚSCULAS sin tildes, p.ej. 'AUTOMATIZACION'
  name       text not null,                 -- nombre visible, p.ej. 'Automatización'
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subject_labs (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id)     on delete cascade,
  lab_id     uuid not null references public.laboratories(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subject_id, lab_id)
);

create index if not exists idx_subject_labs_subject on public.subject_labs (subject_id);
create index if not exists idx_subject_labs_lab     on public.subject_labs (lab_id);

-- ============================================================================
-- 2. IDENTIDAD DEL ESTUDIANTE EN LA RESERVA (sin autenticación)
-- ============================================================================
-- El estudiante ya no tiene fila en auth.users: guardamos su identidad aquí.
-- student_id queda opcional (las reservas anónimas lo dejan NULL); se conserva
-- por compatibilidad con datos previos y por si el Jefe/laboratorista reservara.

alter table public.reservations
  add column if not exists subject_id    uuid references public.subjects(id),
  add column if not exists student_name  text,
  add column if not exists student_email text,
  add column if not exists student_code  text;

alter table public.reservations
  alter column student_id drop not null;

-- Anti-duplicado por CÓDIGO de estudiante (reemplaza, para el flujo anónimo,
-- el rol del índice uq_active_reservation que dependía de auth.uid()).
create unique index if not exists uq_active_reservation_code
  on public.reservations (session_id, student_code)
  where status in ('pendiente', 'aprobada') and student_code is not null;

-- ============================================================================
-- 3. RLS del catálogo nuevo
-- ============================================================================
alter table public.subjects     enable row level security;
alter table public.subject_labs enable row level security;

-- Lectura del catálogo abierta (incluye `anon`): materias activas y su mapeo.
drop policy if exists subjects_select on public.subjects;
create policy subjects_select on public.subjects
  for select using (is_active or public.is_jefe());

drop policy if exists subjectlabs_select on public.subject_labs;
create policy subjectlabs_select on public.subject_labs
  for select using (true);

-- Escritura del catálogo: solo el Jefe (gestión futura desde su panel).
drop policy if exists subjects_write on public.subjects;
create policy subjects_write on public.subjects
  for all using (public.is_jefe()) with check (public.is_jefe());

drop policy if exists subjectlabs_write on public.subject_labs;
create policy subjectlabs_write on public.subject_labs
  for all using (public.is_jefe()) with check (public.is_jefe());

-- ============================================================================
-- 4. GRANTs para el rol anónimo (`anon`)
-- ----------------------------------------------------------------------------
-- RLS sigue filtrando fila por fila; estos GRANTs solo dan el privilegio base.
-- OJO: NO se concede SELECT sobre `reservations` a anon (privacidad de datos).
-- ============================================================================
grant usage on schema public to anon;

grant select on public.laboratories    to anon;
grant select on public.schedule_blocks to anon;
grant select on public.block_sessions  to anon;
grant select on public.subjects        to anon;
grant select on public.subject_labs    to anon;

-- Materializar sesiones futuras al abrir el calendario (idempotente y acotado).
grant execute on function public.ensure_sessions(uuid, date, date) to anon;

-- ============================================================================
-- 5. RPC: solicitar reserva SIN login (rol `anon`)
-- ----------------------------------------------------------------------------
-- Conserva el aforo atómico del flujo autenticado (bloqueo FOR UPDATE) y añade:
--   - validación del correo institucional y del código numérico;
--   - validación de que la sesión pertenece a un lab habilitado por la materia;
--   - anti-duplicado por código de estudiante.
-- ============================================================================
create or replace function public.request_reservation_public(
  p_session_id    uuid,
  p_subject_id    uuid,
  p_student_name  text,
  p_student_email text,
  p_student_code  text
)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.block_sessions;
  v_holds   integer;
  v_res     public.reservations;
  v_name    text := btrim(coalesce(p_student_name, ''));
  v_email   text := lower(btrim(coalesce(p_student_email, '')));
  v_code    text := btrim(coalesce(p_student_code, ''));
begin
  -- 5.1 Validación de entrada (defensa en profundidad; el formulario también valida)
  if length(v_name) < 3 then
    raise exception 'Ingresa tu nombre completo';
  end if;
  if v_email !~* '@unimilitar\.edu\.co$' then
    raise exception 'El correo debe ser institucional @unimilitar.edu.co';
  end if;
  if v_code !~ '^[0-9]{4,15}$' then
    raise exception 'El código de estudiante debe ser numérico (4 a 15 dígitos)';
  end if;

  -- 5.2 La sesión debe pertenecer a un laboratorio habilitado por la materia
  if not exists (
    select 1
      from public.block_sessions s
      join public.subject_labs sl on sl.lab_id = s.lab_id
     where s.id = p_session_id
       and sl.subject_id = p_subject_id
  ) then
    raise exception 'La materia seleccionada no habilita este laboratorio';
  end if;

  -- 5.3 Bloqueo pesimista de la sesión: serializa a quienes compiten por el cupo
  select * into v_session from public.block_sessions where id = p_session_id for update;
  if not found then raise exception 'La sesión no existe'; end if;
  if v_session.status <> 'abierta' then raise exception 'La sesión no está disponible'; end if;
  if v_session.session_date < current_date then raise exception 'La sesión ya finalizó'; end if;

  -- 5.4 Anti-duplicado por código de estudiante
  if exists (
    select 1 from public.reservations
     where session_id = p_session_id
       and student_code = v_code
       and status in ('pendiente', 'aprobada')
  ) then
    raise exception 'Ya tienes una reserva activa para este bloque';
  end if;

  -- 5.5 Chequeo de aforo (sin sobrecupo)
  select count(*) into v_holds from public.reservations
   where session_id = p_session_id and status in ('pendiente', 'aprobada');
  if v_holds >= v_session.capacity then
    raise exception 'No hay aforo disponible en este bloque';
  end if;

  -- 5.6 Inserta la reserva anónima (el trigger refresh_session_count ajusta el cupo)
  insert into public.reservations
    (session_id, student_id, subject_id, student_name, student_email, student_code, status)
  values
    (p_session_id, null, p_subject_id, v_name, v_email, v_code, 'pendiente')
  returning * into v_res;

  return v_res;
end;
$$;

-- ============================================================================
-- 6. RPC: consultar reservas por CÓDIGO + CORREO (seguimiento sin cuenta)
-- ----------------------------------------------------------------------------
-- Devuelve solo las reservas cuyo código Y correo coinciden con lo ingresado.
-- Requerir ambos evita que alguien liste reservas con solo un dato.
-- ============================================================================
create or replace function public.lookup_reservations_public(
  p_student_code  text,
  p_student_email text
)
returns table (
  reservation_id uuid,
  status         public.reservation_status,
  lab_code       text,
  lab_name       text,
  subject_name   text,
  session_date   date,
  start_time     time,
  end_time       time,
  created_at     timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.status, l.code, l.name, sub.name,
         bs.session_date, bs.start_time, bs.end_time, r.created_at
    from public.reservations r
    join public.block_sessions bs on bs.id = r.session_id
    join public.laboratories   l  on l.id  = bs.lab_id
    left join public.subjects  sub on sub.id = r.subject_id
   where r.student_code = btrim(p_student_code)
     and lower(r.student_email) = lower(btrim(p_student_email))
   order by bs.session_date desc, bs.start_time;
$$;

-- ============================================================================
-- 7. RPC: cancelar reserva por CÓDIGO + CORREO (sin cuenta, sin penalidad)
-- ============================================================================
create or replace function public.cancel_reservation_public(
  p_reservation_id uuid,
  p_student_code   text,
  p_student_email  text
)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare v_res public.reservations;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reserva no encontrada'; end if;

  if v_res.student_code is distinct from btrim(p_student_code)
     or lower(coalesce(v_res.student_email, '')) is distinct from lower(btrim(p_student_email)) then
    raise exception 'Los datos no coinciden con la reserva';
  end if;
  if v_res.status not in ('pendiente', 'aprobada') then
    raise exception 'La reserva no se puede cancelar en su estado actual';
  end if;

  update public.reservations
     set status = 'cancelada', cancelled_at = now()
   where id = p_reservation_id
   returning * into v_res;
  return v_res;
end;
$$;

-- Permisos de ejecución de los RPCs públicos.
grant execute on function public.request_reservation_public(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.lookup_reservations_public(text, text)                   to anon, authenticated;
grant execute on function public.cancel_reservation_public(uuid, text, text)              to anon, authenticated;

-- ============================================================================
-- 8. SEED: materias y mapeo Materia → Laboratorio (ejemplos confirmados)
-- ----------------------------------------------------------------------------
-- Automatización        → LABORATORIO AUTOMATIZACIÓN Y CONTROL + LABORATORIO CIM
-- Procesos de mecanizado → LABORATORIO METALES (práctica libre)
-- Tecnología mecánica    → LABORATORIO METALES (práctica libre)
-- Añade más materias replicando este patrón.
-- ============================================================================
insert into public.subjects (code, name) values
  ('AUTOMATIZACION',      'Automatización'),
  ('PROCESOS_MECANIZADO', 'Procesos de mecanizado'),
  ('TECNOLOGIA_MECANICA', 'Tecnología mecánica')
on conflict (code) do nothing;

insert into public.subject_labs (subject_id, lab_id)
select s.id, l.id
  from public.subjects s
  join public.laboratories l on l.code in ('AUTOMATIZACION_CONTROL', 'CIM')
 where s.code = 'AUTOMATIZACION'
on conflict (subject_id, lab_id) do nothing;

insert into public.subject_labs (subject_id, lab_id)
select s.id, l.id
  from public.subjects s
  join public.laboratories l on l.code = 'METALES'
 where s.code = 'PROCESOS_MECANIZADO'
on conflict (subject_id, lab_id) do nothing;

insert into public.subject_labs (subject_id, lab_id)
select s.id, l.id
  from public.subjects s
  join public.laboratories l on l.code = 'METALES'
 where s.code = 'TECNOLOGIA_MECANICA'
on conflict (subject_id, lab_id) do nothing;

-- Verificación rápida (debe listar 3 materias y 4 filas de mapeo):
-- select s.name, l.code from public.subject_labs sl
--   join public.subjects s on s.id = sl.subject_id
--   join public.laboratories l on l.id = sl.lab_id
--  order by s.name, l.code;
