-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0013_attendance_window.sql — asistencia desde 30 min ANTES del inicio
-- ----------------------------------------------------------------------------
-- POR QUÉ CAMBIA
--   La 0008 permitía registrar asistencia solo cuando la sesión ya había
--   TERMINADO:
--       (session_date + end_time) at time zone 'America/Bogota' < now()
--   Sirve para marcar en diferido, pero bloquea el flujo real del laboratorio y,
--   sobre todo, el escáner de carné (Fase 4): el laboratorista escanea a los
--   estudiantes MIENTRAS ENTRAN, no al día siguiente. Con la regla vieja la
--   sesión ni siquiera aparecía en la lista, y mark_session_attendance lanzaba
--   "La sesión aún no ha terminado".
--
-- REGLA NUEVA (confirmada con la División de Laboratorios, agosto 2026)
--   El registro se habilita 30 MINUTOS ANTES de la hora de inicio y queda
--   abierto indefinidamente hacia atrás (para corregir después).
--
-- Además se expone la columna `estado` para que el panel distinga de un vistazo
-- qué está pasando ahora mismo:
--     por_iniciar → arranca dentro de los próximos 30 minutos
--     en_curso    → está ocurriendo
--     finalizada  → ya terminó
--
-- ZONA HORARIA: se mantiene el patrón obligatorio del proyecto —
--   (session_date + hora) at time zone 'America/Bogota'  antes de comparar con now().
--
-- OJO: se agrega una columna al retorno de attendance_sessions(), y Postgres no
-- permite cambiar el tipo de retorno con `create or replace`. Por eso el DROP
-- previo, y por eso hay que volver a otorgar el GRANT al final.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1) Sesiones con asistencia registrable.
--    Incluye las que ya pasaron y las que arrancan dentro de 30 minutos.
-- ---------------------------------------------------------------------------
drop function if exists public.attendance_sessions();

create or replace function public.attendance_sessions()
returns table (
  session_id   uuid,
  lab_id       uuid,
  lab_code     text,
  lab_name     text,
  session_date date,
  start_time   time,
  end_time     time,
  aprobadas    bigint,
  marcadas     bigint,
  estado       text
)
language sql
security definer
set search_path = public
as $$
  select t.session_id, t.lab_id, t.lab_code, t.lab_name,
         t.session_date, t.start_time, t.end_time,
         t.aprobadas, t.marcadas, t.estado
  from (
    select
      bs.id                                                                          as session_id,
      bs.lab_id,
      l.code                                                                         as lab_code,
      l.name                                                                         as lab_name,
      bs.session_date,
      bs.start_time,
      bs.end_time,
      count(r.*) filter (where r.status = 'aprobada'::reservation_status)             as aprobadas,
      count(r.*) filter (where r.status = 'aprobada'::reservation_status
                           and r.attended is not null)                               as marcadas,
      case
        when ((bs.session_date + bs.end_time)   at time zone 'America/Bogota') < now() then 'finalizada'
        when ((bs.session_date + bs.start_time) at time zone 'America/Bogota') <= now() then 'en_curso'
        else 'por_iniciar'
      end                                                                            as estado
    from public.block_sessions bs
    join public.laboratories l on l.id = bs.lab_id
    join public.reservations r on r.session_id = bs.id
    where (public.is_lab_admin(bs.lab_id) or public.is_jefe())
      -- Se habilita 30 minutos antes del inicio (antes: solo tras finalizar).
      and ((bs.session_date + bs.start_time) at time zone 'America/Bogota')
            <= now() + interval '30 minutes'
    group by bs.id, bs.lab_id, l.code, l.name, bs.session_date, bs.start_time, bs.end_time
    having count(r.*) filter (where r.status = 'aprobada'::reservation_status) > 0
  ) t
  order by
    -- Lo accionable primero: lo que ocurre ahora, luego lo inminente, luego el histórico.
    case t.estado when 'en_curso' then 0 when 'por_iniciar' then 1 else 2 end,
    (t.marcadas < t.aprobadas) desc,   -- dentro de cada grupo, lo que falta por marcar
    t.session_date desc,
    t.start_time;
$$;

-- ---------------------------------------------------------------------------
-- 2) Marcar asistencia: el candado pasa de "ya terminó" a "faltan ≤ 30 min".
-- ---------------------------------------------------------------------------
create or replace function public.mark_session_attendance(
  p_session_id uuid,
  p_absent_ids uuid[] default '{}'::uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_antelacion    constant interval := interval '30 minutes';
  v_lab_id        uuid;
  v_start_instant timestamptz;
  v_count         integer;
begin
  select bs.lab_id,
         (bs.session_date + bs.start_time) at time zone 'America/Bogota'
    into v_lab_id, v_start_instant
  from public.block_sessions bs
  where bs.id = p_session_id;

  if v_lab_id is null then
    raise exception 'Sesión no encontrada';
  end if;

  if not (public.is_lab_admin(v_lab_id) or public.is_jefe()) then
    raise exception 'No autorizado para este laboratorio';
  end if;

  if v_start_instant > now() + c_antelacion then
    raise exception 'Aún no se puede registrar asistencia: la sesión inicia en más de 30 minutos';
  end if;

  update public.reservations r
     set attended   = not (r.id = any (coalesce(p_absent_ids, '{}'::uuid[]))),
         updated_at = now()
   where r.session_id = p_session_id
     and r.status = 'aprobada'::reservation_status;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Permisos. El GRANT de attendance_sessions se perdió con el DROP.
-- ---------------------------------------------------------------------------
grant execute on function public.attendance_sessions()                 to authenticated;
grant execute on function public.mark_session_attendance(uuid, uuid[]) to authenticated;

-- ============================================================================
-- Verificación sugerida (como laboratorista o jefe):
--   select lab_code, session_date, start_time, estado, aprobadas, marcadas
--     from public.attendance_sessions();
-- La práctica del viernes debe aparecer como 'por_iniciar' ese mismo día,
-- 30 minutos antes de las 14:00.
-- ============================================================================
