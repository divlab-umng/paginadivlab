-- 0008_mark_attendance.sql
-- Registro de asistencia por sesión (rol laboratorista; jefe también, por si necesita corregir).
-- Alimenta las columnas asistencias/inasistencias que v_lab_usage ya expone.
--
-- La columna reservations.attended (boolean, nullable) YA existe. Semántica:
--   null  = sin registrar   (no cuenta como asistencia ni inasistencia)
--   true  = asistió
--   false = no asistió
--
-- ZONA HORARIA (importante): las sesiones se guardan en hora LOCAL de Colombia como
--   block_sessions.session_date (date) + block_sessions.end_time (time SIN zona).
--   El servidor Postgres corre en UTC. Para saber si una sesión ya terminó hay que
--   interpretar ese "reloj de pared" en America/Bogota y convertirlo a instante
--   absoluto ANTES de comparar con now():
--       (session_date + end_time) AT TIME ZONE 'America/Bogota' < now()
--   No comparar contra now() sin esta conversión (bug de zona horaria ya conocido).
--
-- No modifica cupo ni estado de la reserva: la asistencia es solo métrica (sin penalidad).

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1) Sesiones ya terminadas de los labs que administra el usuario,
--    con conteo de reservas aprobadas y cuántas ya están marcadas.
--    Ordena las que tienen marcado pendiente primero.
-- ---------------------------------------------------------------------------
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
  marcadas     bigint
)
language sql
security definer
set search_path = public
as $$
  select
    bs.id                                                                                              as session_id,
    bs.lab_id,
    l.code                                                                                             as lab_code,
    l.name                                                                                             as lab_name,
    bs.session_date,
    bs.start_time,
    bs.end_time,
    count(r.*) filter (where r.status = 'aprobada'::reservation_status)                                as aprobadas,
    count(r.*) filter (where r.status = 'aprobada'::reservation_status and r.attended is not null)     as marcadas
  from public.block_sessions bs
  join public.laboratories l on l.id = bs.lab_id
  join public.reservations r on r.session_id = bs.id
  where (public.is_lab_admin(bs.lab_id) or public.is_jefe())
    and (bs.session_date + bs.end_time) at time zone 'America/Bogota' < now()
  group by bs.id, bs.lab_id, l.code, l.name, bs.session_date, bs.start_time, bs.end_time
  having count(r.*) filter (where r.status = 'aprobada'::reservation_status) > 0
  order by
    (count(r.*) filter (where r.status = 'aprobada'::reservation_status and r.attended is not null)
       < count(r.*) filter (where r.status = 'aprobada'::reservation_status)) desc,   -- pendientes primero
    bs.session_date desc,
    bs.start_time;
$$;

-- ---------------------------------------------------------------------------
-- 2) Asistentes aprobados de una sesión (para pre-marcar "todos presentes").
--    Valida que el usuario administre el lab de la sesión.
-- ---------------------------------------------------------------------------
create or replace function public.session_attendees(p_session_id uuid)
returns table (
  reservation_id uuid,
  student_id     uuid,
  full_name      text,
  email          text,
  attended       boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab_id uuid;
begin
  select bs.lab_id into v_lab_id
  from public.block_sessions bs
  where bs.id = p_session_id;

  if v_lab_id is null then
    raise exception 'Sesión no encontrada';
  end if;

  if not (public.is_lab_admin(v_lab_id) or public.is_jefe()) then
    raise exception 'No autorizado para este laboratorio';
  end if;

  return query
    select r.id, r.student_id, p.full_name, p.email, r.attended
    from public.reservations r
    join public.profiles p on p.id = r.student_id
    where r.session_id = p_session_id
      and r.status = 'aprobada'::reservation_status
    order by p.full_name nulls last, p.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Marca la asistencia de una sesión completa en un solo confirm.
--    p_absent_ids = ids de RESERVACIÓN (uuid) que estuvieron AUSENTES.
--    Todas las aprobadas quedan attended = true, salvo las de la lista → false.
--    Valida autorización y que la sesión ya haya terminado.
--    Devuelve cuántas reservas se marcaron.
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
  v_lab_id      uuid;
  v_end_instant timestamptz;
  v_count       integer;
begin
  select bs.lab_id,
         (bs.session_date + bs.end_time) at time zone 'America/Bogota'
    into v_lab_id, v_end_instant
  from public.block_sessions bs
  where bs.id = p_session_id;

  if v_lab_id is null then
    raise exception 'Sesión no encontrada';
  end if;

  if not (public.is_lab_admin(v_lab_id) or public.is_jefe()) then
    raise exception 'No autorizado para este laboratorio';
  end if;

  if v_end_instant >= now() then
    raise exception 'La sesión aún no ha terminado; no se puede registrar asistencia';
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
-- Permisos: ejecución para usuarios autenticados.
-- La autorización fina (is_lab_admin / is_jefe) la hace cada RPC internamente.
-- ---------------------------------------------------------------------------
grant execute on function public.attendance_sessions()                 to authenticated;
grant execute on function public.session_attendees(uuid)               to authenticated;
grant execute on function public.mark_session_attendance(uuid, uuid[]) to authenticated;
