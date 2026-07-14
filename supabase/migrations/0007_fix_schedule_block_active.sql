-- 0007_fix_schedule_block_active.sql
-- Corrige los RPC de la migración 0006: la columna real en schedule_blocks es
-- `is_active` (no `active`). Reescribe create_schedule_block y
-- deactivate_schedule_block con el nombre correcto. También ajusta la política
-- RLS de lectura no depende de esa columna, así que no se toca.
--
-- Contexto del esquema real (0001_init.sql):
--   schedule_blocks(id, lab_id, weekday smallint CHECK 1..7 [ISO], start_time,
--                   end_time, capacity, is_active boolean, valid_from, valid_until,
--                   created_at)
--   UNIQUE (lab_id, weekday, start_time)

begin;

-- ── RPC: crear un bloque horario (corregido: is_active) ─────────────────────
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

  -- Validaciones de negocio (weekday ISO 1..7: 1=Lunes … 7=Domingo).
  if p_weekday is null or p_weekday < 1 or p_weekday > 7 then
    raise exception 'Día de la semana inválido (1-7, ISO)';
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
      and is_active
  ) then
    raise exception 'Ya existe un bloque activo para ese día y hora de inicio';
  end if;

  insert into public.schedule_blocks (lab_id, weekday, start_time, end_time, capacity, is_active)
  values (p_lab_id, p_weekday, v_start, v_end, p_capacity, true)
  returning * into v_block;

  -- Materializa las sesiones del bloque recién creado (idempotente).
  perform public.ensure_sessions(p_lab_id, v_from, v_to);

  return v_block;
end;
$$;

grant execute on function public.create_schedule_block(uuid, int, text, text, int) to authenticated;

-- ── RPC: desactivar un bloque (corregido: is_active) ────────────────────────
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
     set is_active = false
   where id = p_block_id
   returning * into v_block;

  return v_block;
end;
$$;

grant execute on function public.deactivate_schedule_block(uuid) to authenticated;

commit;
