-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios
-- Esquema PostgreSQL para Supabase
-- ----------------------------------------------------------------------------
-- Alcance: usuarios/roles, laboratorios, bloques horarios fijos (recurrentes),
-- sesiones concretas (materializadas por fecha), reservas con control de aforo.
-- NO incluye inventario/préstamo de equipos (fuera de alcance por diseño).
--
-- Orden de ejecución sugerido: pega este archivo completo en el SQL Editor de
-- Supabase, o guárdalo como supabase/migrations/0001_init.sql y aplica con la CLI.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. TIPOS
-- ============================================================================
create type public.user_role          as enum ('estudiante', 'laboratorista', 'jefe');
create type public.reservation_status as enum ('pendiente', 'aprobada', 'rechazada', 'cancelada');
create type public.session_status     as enum ('abierta', 'cerrada', 'cancelada');

-- ============================================================================
-- 2. TABLAS
-- ============================================================================

-- 2.1 Perfiles (extiende auth.users). El rol vive aquí.
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       public.user_role not null default 'estudiante',
  created_at timestamptz not null default now()
);

-- 2.2 Laboratorios (los 57 espacios físicos)
create table public.laboratories (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique not null,          -- p.ej. 'METALES', 'CIM', 'AUTOMATIZACION'
  name                 text not null,
  description          text,
  location             text,                          -- edificio / campus / salón
  requirements_pdf_url text,                          -- PDF de implementos (Supabase Storage)
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

-- 2.3 Asignación laboratorista ↔ laboratorio (N:M por flexibilidad)
create table public.lab_admins (
  id         uuid primary key default gen_random_uuid(),
  lab_id     uuid not null references public.laboratories(id) on delete cascade,
  admin_id   uuid not null references public.profiles(id)     on delete cascade,
  created_at timestamptz not null default now(),
  unique (lab_id, admin_id)
);

-- 2.4 Bloques horarios FIJOS (plantillas recurrentes por día de semana)
--     El estudiante NO elige horario libre: solo estos bloques.
create table public.schedule_blocks (
  id          uuid primary key default gen_random_uuid(),
  lab_id      uuid not null references public.laboratories(id) on delete cascade,
  weekday     smallint not null check (weekday between 1 and 7), -- ISO: 1=Lun … 7=Dom
  start_time  time not null,
  end_time    time not null,
  capacity    integer not null check (capacity > 0),             -- aforo máximo del bloque
  is_active   boolean not null default true,
  valid_from  date,   -- opcional: vigencia del bloque (inicio de semestre)
  valid_until date,   -- opcional: fin de vigencia
  created_at  timestamptz not null default now(),
  check (end_time > start_time),
  unique (lab_id, weekday, start_time)
);

-- 2.5 Sesiones concretas (una instancia de un bloque en una fecha específica).
--     Se materializan bajo demanda con ensure_sessions() o vía pg_cron.
create table public.block_sessions (
  id             uuid primary key default gen_random_uuid(),
  block_id       uuid not null references public.schedule_blocks(id) on delete cascade,
  lab_id         uuid not null references public.laboratories(id)    on delete cascade, -- denormalizado (RLS/consultas)
  session_date   date not null,
  start_time     time not null,
  end_time       time not null,
  capacity       integer not null check (capacity > 0),
  reserved_count integer not null default 0 check (reserved_count >= 0), -- cache de cupos tomados
  status         public.session_status not null default 'abierta',
  created_at     timestamptz not null default now(),
  unique (block_id, session_date)
);

-- 2.6 Reservas (una fila = un estudiante en una sesión)
create table public.reservations (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.block_sessions(id) on delete cascade,
  student_id      uuid not null references public.profiles(id)       on delete cascade,
  status          public.reservation_status not null default 'pendiente',
  attended        boolean,                 -- lo marca el laboratorista tras la práctica (stats de asistencia)
  decision_reason text,                    -- motivo de rechazo (opcional)
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Un estudiante no puede tener 2 reservas ACTIVAS en la misma sesión,
-- pero SÍ puede volver a reservar si antes canceló/fue rechazado (índice parcial).
create unique index uq_active_reservation
  on public.reservations (session_id, student_id)
  where status in ('pendiente', 'aprobada');

-- Índices de apoyo
create index idx_sessions_lab_date on public.block_sessions (lab_id, session_date);
create index idx_reservations_session on public.reservations (session_id);
create index idx_reservations_student on public.reservations (student_id);

-- ============================================================================
-- 3. FUNCIONES AUXILIARES (SECURITY DEFINER → evitan recursión en RLS)
-- ============================================================================

-- Rol del usuario actual (lee profiles saltándose RLS de forma segura)
create or replace function public.user_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid(); $$;

create or replace function public.is_jefe()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.user_role() = 'jefe'; $$;

create or replace function public.is_lab_admin(p_lab_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.lab_admins
     where lab_id = p_lab_id and admin_id = auth.uid()
  );
$$;

-- ============================================================================
-- 4. TRIGGERS DE INTEGRIDAD
-- ============================================================================

-- 4.1 Al crearse un usuario en auth.users: valida dominio y crea su perfil.
--     Si el correo no es institucional, la excepción revierte el signup completo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.email !~* '@unimilitar\.edu\.co$' then
    raise exception 'Solo se permite el registro con correo institucional @unimilitar.edu.co';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'estudiante'  -- rol por defecto; el Jefe promueve laboratoristas manualmente
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4.2 Impide que un usuario se auto-promueva de rol. Solo el Jefe cambia roles.
create or replace function public.guard_role_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_jefe() then
    raise exception 'No tienes permiso para cambiar roles';
  end if;
  return new;
end;
$$;

create trigger trg_guard_role_change
before update on public.profiles
for each row execute function public.guard_role_change();

-- 4.3 Mantiene reserved_count sincronizado y serializa recuentos con bloqueo.
create or replace function public.refresh_session_count()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_session uuid := coalesce(new.session_id, old.session_id);
begin
  -- Bloqueo pesimista de la sesión: evita condiciones de carrera en el aforo.
  perform 1 from public.block_sessions where id = v_session for update;

  update public.block_sessions
     set reserved_count = (
       select count(*) from public.reservations
        where session_id = v_session
          and status in ('pendiente', 'aprobada')
     )
   where id = v_session;

  return coalesce(new, old);
end;
$$;

create trigger trg_refresh_session_count
after insert or delete or update of status on public.reservations
for each row execute function public.refresh_session_count();

-- 4.4 updated_at automático en reservas
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

create trigger trg_reservations_touch
before update on public.reservations
for each row execute function public.touch_updated_at();

-- ============================================================================
-- 5. RPCs DE NEGOCIO (toda mutación de reservas pasa por aquí)
-- ============================================================================

-- 5.1 Materializa sesiones de un lab en un rango de fechas (idempotente).
--     Llámala al mostrar disponibilidad. Alternativa: pg_cron nocturno.
create or replace function public.ensure_sessions(p_lab_id uuid, p_from date, p_to date)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.block_sessions (block_id, lab_id, session_date, start_time, end_time, capacity, status)
  select b.id, b.lab_id, g.d::date, b.start_time, b.end_time, b.capacity, 'abierta'
    from public.schedule_blocks b
    cross join generate_series(p_from, p_to, interval '1 day') as g(d)
   where b.lab_id = p_lab_id
     and b.is_active
     and extract(isodow from g.d)::int = b.weekday
     and (b.valid_from  is null or g.d::date >= b.valid_from)
     and (b.valid_until is null or g.d::date <= b.valid_until)
  on conflict (block_id, session_date) do nothing;
end;
$$;

-- 5.2 Solicitar reserva (estudiante). Atómica: bloqueo + chequeo de aforo + insert.
create or replace function public.request_reservation(p_session_id uuid)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.block_sessions;
  v_holds   integer;
  v_res     public.reservations;
  v_uid     uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  if public.user_role() <> 'estudiante' then
    raise exception 'Solo los estudiantes pueden reservar';
  end if;

  -- Bloqueo de la sesión: serializa a quienes compiten por el último cupo.
  select * into v_session from public.block_sessions where id = p_session_id for update;
  if not found then raise exception 'La sesión no existe'; end if;
  if v_session.status <> 'abierta' then raise exception 'La sesión no está disponible'; end if;
  if v_session.session_date < current_date then raise exception 'La sesión ya finalizó'; end if;

  if exists (
    select 1 from public.reservations
     where session_id = p_session_id and student_id = v_uid
       and status in ('pendiente', 'aprobada')
  ) then
    raise exception 'Ya tienes una reserva activa para esta sesión';
  end if;

  select count(*) into v_holds from public.reservations
   where session_id = p_session_id and status in ('pendiente', 'aprobada');
  if v_holds >= v_session.capacity then
    raise exception 'No hay aforo disponible en este bloque';
  end if;

  insert into public.reservations (session_id, student_id, status)
  values (p_session_id, v_uid, 'pendiente')
  returning * into v_res;

  return v_res;  -- el trigger actualiza reserved_count
end;
$$;

-- 5.3 Cancelar reserva (estudiante, sin penalidad). Libera el cupo.
create or replace function public.cancel_reservation(p_reservation_id uuid)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare v_res public.reservations; v_uid uuid := auth.uid();
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reserva no encontrada'; end if;
  if v_res.student_id <> v_uid then raise exception 'No puedes cancelar esta reserva'; end if;
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

-- 5.4 Aprobar/Rechazar (laboratorista del lab correspondiente o Jefe).
--     El envío del correo (Resend) se dispara desde la Server Action tras esto.
create or replace function public.decide_reservation(
  p_reservation_id uuid,
  p_approve        boolean,
  p_reason         text default null
)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare v_res public.reservations; v_lab uuid;
begin
  select s.lab_id into v_lab
    from public.reservations r
    join public.block_sessions s on s.id = r.session_id
   where r.id = p_reservation_id
   for update;

  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'Reserva no encontrada'; end if;
  if not (public.is_lab_admin(v_lab) or public.is_jefe()) then
    raise exception 'No administras este laboratorio';
  end if;
  if v_res.status <> 'pendiente' then
    raise exception 'Solo se pueden decidir reservas pendientes';
  end if;

  update public.reservations
     set status          = case when p_approve then 'aprobada' else 'rechazada' end,
         decision_reason = p_reason,
         decided_by      = auth.uid(),
         decided_at      = now()
   where id = p_reservation_id
   returning * into v_res;
  return v_res;
end;
$$;

-- Permisos de ejecución
grant execute on function public.ensure_sessions(uuid, date, date)         to authenticated;
grant execute on function public.request_reservation(uuid)                 to authenticated;
grant execute on function public.cancel_reservation(uuid)                  to authenticated;
grant execute on function public.decide_reservation(uuid, boolean, text)   to authenticated;

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles        enable row level security;
alter table public.laboratories    enable row level security;
alter table public.lab_admins      enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.block_sessions  enable row level security;
alter table public.reservations    enable row level security;

-- 6.1 profiles: cada quien ve el suyo; el Jefe ve todos; un laboratorista ve a
--     los estudiantes con reserva en sus labs (para gestionar solicitudes).
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_jefe()
  or exists (
    select 1 from public.reservations r
      join public.block_sessions s on s.id = r.session_id
     where r.student_id = profiles.id and public.is_lab_admin(s.lab_id)
  )
);
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_jefe())
  with check (id = auth.uid() or public.is_jefe());  -- el cambio de rol lo bloquea guard_role_change()

-- 6.2 laboratories
create policy labs_select on public.laboratories for select
  using (is_active or public.is_lab_admin(id) or public.is_jefe());
create policy labs_insert on public.laboratories for insert with check (public.is_jefe());
create policy labs_update on public.laboratories for update
  using (public.is_lab_admin(id) or public.is_jefe());
create policy labs_delete on public.laboratories for delete using (public.is_jefe());

-- 6.3 lab_admins (solo el Jefe gestiona asignaciones)
create policy labadmins_select on public.lab_admins for select
  using (admin_id = auth.uid() or public.is_jefe());
create policy labadmins_all on public.lab_admins for all
  using (public.is_jefe()) with check (public.is_jefe());

-- 6.4 schedule_blocks: lectura para todos (ver disponibilidad); escritura al dueño del lab
create policy blocks_select on public.schedule_blocks for select using (true);
create policy blocks_write on public.schedule_blocks for all
  using (public.is_lab_admin(lab_id) or public.is_jefe())
  with check (public.is_lab_admin(lab_id) or public.is_jefe());

-- 6.5 block_sessions: lectura para todos; escritura al dueño del lab
create policy sessions_select on public.block_sessions for select using (true);
create policy sessions_write on public.block_sessions for all
  using (public.is_lab_admin(lab_id) or public.is_jefe())
  with check (public.is_lab_admin(lab_id) or public.is_jefe());

-- 6.6 reservations: el estudiante ve las suyas; el laboratorista las de su lab; el Jefe todas.
--     Las MUTACIONES no tienen policy → solo ocurren vía RPCs SECURITY DEFINER.
create policy reservations_select on public.reservations for select using (
  student_id = auth.uid()
  or public.is_jefe()
  or exists (
    select 1 from public.block_sessions s
     where s.id = reservations.session_id and public.is_lab_admin(s.lab_id)
  )
);

-- ============================================================================
-- 7. VISTAS PARA EL DASHBOARD DEL JEFE (security_invoker → respetan RLS)
-- ============================================================================

-- 7.1 Uso agregado por laboratorio
create or replace view public.v_lab_usage with (security_invoker = true) as
select l.id as lab_id, l.code, l.name,
       count(r.*) filter (where r.status = 'aprobada')   as reservas_aprobadas,
       count(r.*) filter (where r.status = 'pendiente')  as reservas_pendientes,
       count(r.*) filter (where r.status = 'rechazada')  as reservas_rechazadas,
       count(r.*) filter (where r.status = 'cancelada')  as reservas_canceladas,
       count(r.*) filter (where r.attended is true)      as asistencias,
       count(r.*) filter (where r.attended is false)     as inasistencias
  from public.laboratories l
  left join public.block_sessions s on s.lab_id = l.id
  left join public.reservations   r on r.session_id = s.id
 group by l.id, l.code, l.name;

-- 7.2 Demanda por franja horaria (día de semana + hora de inicio)
create or replace view public.v_demanda_horaria with (security_invoker = true) as
select s.lab_id,
       extract(isodow from s.session_date)::int as dia_semana,
       s.start_time,
       count(r.*) filter (where r.status in ('aprobada', 'pendiente')) as solicitudes
  from public.block_sessions s
  left join public.reservations r on r.session_id = s.id
 group by s.lab_id, dia_semana, s.start_time;

-- 7.3 Ocupación por sesión (cupos usados vs. aforo)
create or replace view public.v_ocupacion_sesion with (security_invoker = true) as
select s.id as session_id, s.lab_id, s.session_date, s.start_time, s.end_time,
       s.capacity, s.reserved_count,
       round(100.0 * s.reserved_count / nullif(s.capacity, 0), 1) as ocupacion_pct
  from public.block_sessions s;

-- ============================================================================
-- 8. SEED DE EJEMPLO (opcional — descomenta para probar)
-- ============================================================================
-- insert into public.laboratories (code, name, location) values
--   ('METALES',        'Laboratorio de Metales',        'Campus Cajicá'),
--   ('CIM',            'Laboratorio CIM',               'Campus Cajicá'),
--   ('AUTOMATIZACION', 'Laboratorio de Automatización', 'Campus Cajicá');
--
-- -- Bloque fijo: miércoles (weekday=3) 08:00–11:00, aforo 15, en Metales
-- insert into public.schedule_blocks (lab_id, weekday, start_time, end_time, capacity)
-- select id, 3, '08:00', '11:00', 15 from public.laboratories where code = 'METALES';
-- ============================================================================
