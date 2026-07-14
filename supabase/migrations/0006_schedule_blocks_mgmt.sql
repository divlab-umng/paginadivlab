-- 0006_schedule_blocks_mgmt.sql
-- Gestión de bloques horarios desde el panel del laboratorista.
-- Añade: RLS de lectura de schedule_blocks para lab admins, un helper para
-- listar "mis labs", y RPCs SECURITY DEFINER para crear y desactivar bloques.
--
-- SUPUESTOS de columnas de schedule_blocks (ajustar si tu 0001_init.sql difiere):
--   id uuid, lab_id uuid, weekday int, start_time time, end_time time,
--   capacity int, active boolean, created_at timestamptz.

begin;

-- ── RLS: los lab admins (y el jefe) leen los bloques de sus labs ─────────────
alter table public.schedule_blocks enable row level security;

drop policy if exists "schedule_blocks_select_admin" on public.schedule_blocks;
create policy "schedule_blocks_select_admin"
  on public.schedule_blocks
  for select
  to authenticated
  using ( public.is_lab_admin(lab_id) or public.is_jefe() );

-- Sin INSERT/UPDATE directo: toda mutación pasa por los RPC de abajo.
grant select on public.schedule_blocks to authenticated;

-- ── Helper: labs que administra el usuario actual ───────────────────────────
-- Reutiliza is_lab_admin/is_jefe para no depender de las columnas de lab_admins
-- en la capa TS. Devuelve filas completas de laboratories.
create or replace function public.my_admin_labs()
returns setof public.laboratories
language sql
security definer
set search_path = public
stable
as $$
  select l.*
  from public.laboratories l
  where public.is_lab_admin(l.id) or public.is_jefe()
  order by l.name;
$$;

grant execute on function public.my_admin_labs() to authenticated;

-- ── RPC: crear un bloque horario ────────────────────────────────────────────
create or replace function public.create_schedule_block(
  p_lab_id   uuid,
  p_weekday  int,
  p_start    text,   -- 'HH:MM' — se castea a time internamente
  p_end      text,
  p_capacity int
)
returns public.schedule_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block public.schedule_blocks;
  v_start time := p_start::time;
  v_end   time := p_end::time;
  v_from  date := current_date;
  v_to    date := current_date + interval '56 days';  -- materializa 8 semanas
begin
  -- Autorización: solo admin del lab o jefe.
  if not (public.is_lab_admin(p_lab_id) or public.is_jefe()) then
    raise exception 'No autorizado para gestionar horarios de este laboratorio'
      using errcode = '42501';
  end if;

  -- Validaciones de negocio.
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 then
    raise exception 'Día de la semana inválido (0-6)';
  end if;
  if v_end <= v_start then
    raise exception 'La hora de fin debe ser posterior a la de inicio';
  end if;
  if p_capacity is null or p_capacity < 1 then
    raise exception 'El aforo debe ser al menos 1';
  end if;

  -- Evita bloques duplicados exactos (mismo lab, día y hora de inicio, activos).
  if exists (
    select 1 from public.schedule_blocks
    where lab_id = p_lab_id
      and weekday = p_weekday
      and start_time = v_start
      and active
  ) then
    raise exception 'Ya existe un bloque activo para ese día y hora de inicio';
  end if;

  insert into public.schedule_blocks (lab_id, weekday, start_time, end_time, capacity, active)
  values (p_lab_id, p_weekday, v_start, v_end, p_capacity, true)
  returning * into v_block;

  -- Materializa las sesiones del bloque recién creado (idempotente).
  perform public.ensure_sessions(p_lab_id, v_from, v_to);

  return v_block;
end;
$$;

grant execute on function public.create_schedule_block(uuid, int, text, text, int) to authenticated;

-- ── RPC: desactivar un bloque (soft-delete) ─────────────────────────────────
-- Nota: solo marca active=false. Las sesiones futuras ya materializadas en
-- block_sessions NO se tocan aquí (podrían tener reservas). La limpieza de
-- sesiones vacías es un paso aparte que requiere ver el esquema de block_sessions.
create or replace function public.deactivate_schedule_block(p_block_id uuid)
returns public.schedule_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block public.schedule_blocks;
begin
  select * into v_block from public.schedule_blocks where id = p_block_id;
  if not found then
    raise exception 'Bloque no encontrado';
  end if;

  if not (public.is_lab_admin(v_block.lab_id) or public.is_jefe()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  update public.schedule_blocks
     set active = false
   where id = p_block_id
   returning * into v_block;

  return v_block;
end;
$$;

grant execute on function public.deactivate_schedule_block(uuid) to authenticated;

commit;
