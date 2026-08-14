-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0015_dashboard_export.sql — FASE 5: métricas por semestre y export
-- ----------------------------------------------------------------------------
-- Aporta las dos vistas que alimentan el panel del jefe:
--   1) v_reservas_detalle  → una fila por reserva, con TODO lo relevante.
--                            Es la fuente del archivo Excel.
--   2) v_semestre_resumen  → agregado por semestre, para las tarjetas y la
--                            tabla del histórico.
--
-- SEMESTRE (convención colombiana): I = enero–junio, II = julio–diciembre.
-- Se calcula desde session_date, es decir, el semestre en que OCURRE la
-- práctica (no en el que se solicitó). Es lo que tiene sentido para planear.
--
-- LEFT JOIN a propósito en students/profiles/subjects: hay reservas anteriores
-- al rediseño (con student_id → profiles y sin materia). Con INNER JOIN esas
-- filas desaparecerían del Excel y del histórico, y el jefe vería cifras
-- incompletas sin saberlo.
--
-- ¡OJO CON coalesce Y LAS CADENAS VACÍAS! El trigger handle_new_user guarda
--   full_name = coalesce(raw_user_meta_data->>'full_name', '')
-- es decir, CADENA VACÍA cuando no hay metadato, no NULL. Un coalesce simple
--   coalesce(st.full_name, p.full_name, r.student_name)
-- se detendría en ese '' y el Excel saldría con el nombre en blanco. Por eso
-- cada nivel va envuelto en nullif(btrim(...), ''). Detectado en pruebas.
--
-- security_invoker: las vistas corren con los permisos de quien consulta, así
-- que la RLS ya vigente decide qué ve cada rol (el jefe, todo).
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1) Detalle de reservas — fuente del Excel
-- ---------------------------------------------------------------------------
create or replace view public.v_reservas_detalle with (security_invoker = true) as
select
  r.id                                                     as reservation_id,
  (extract(year from bs.session_date)::int::text || '-' ||
     case when extract(month from bs.session_date) <= 6 then 'I' else 'II' end)
                                                           as semestre,
  bs.session_date,
  bs.start_time,
  bs.end_time,
  round(extract(epoch from (bs.end_time - bs.start_time)) / 3600.0, 2)
                                                           as horas,
  l.code                                                   as lab_code,
  l.name                                                   as lab_name,
  sub.name                                                 as materia,
  coalesce(nullif(btrim(st.student_code), ''),
           nullif(btrim(r.student_code), ''))              as codigo_estudiante,
  coalesce(nullif(btrim(st.full_name), ''),
           nullif(btrim(p.full_name), ''),
           nullif(btrim(r.student_name), ''))              as estudiante,
  coalesce(nullif(btrim(st.email), ''),
           nullif(btrim(p.email), ''),
           nullif(btrim(r.student_email), ''))             as correo,
  r.status                                                 as estado,
  r.attended                                               as asistio,
  r.created_at                                             as solicitada_en,
  r.decided_at                                             as decidida_en,
  r.decision_reason                                        as motivo_decision,
  dec.full_name                                            as decidida_por,
  r.cancelled_at                                           as cancelada_en
from public.reservations r
join      public.block_sessions bs  on bs.id  = r.session_id
join      public.laboratories   l   on l.id   = bs.lab_id
left join public.students       st  on st.id  = r.student_ref
left join public.profiles       p   on p.id   = r.student_id
left join public.subjects       sub on sub.id = r.subject_id
left join public.profiles       dec on dec.id = r.decided_by;

-- ---------------------------------------------------------------------------
-- 2) Resumen por semestre — tarjetas e histórico del panel
-- ---------------------------------------------------------------------------
create or replace view public.v_semestre_resumen with (security_invoker = true) as
select
  semestre,
  count(*)                                          as solicitudes,
  count(*) filter (where estado = 'aprobada'::reservation_status)   as aprobadas,
  count(*) filter (where estado = 'pendiente'::reservation_status)  as pendientes,
  count(*) filter (where estado = 'rechazada'::reservation_status)  as rechazadas,
  count(*) filter (where estado = 'cancelada'::reservation_status)  as canceladas,
  count(*) filter (where asistio is true)                           as asistencias,
  count(*) filter (where asistio is false)                          as inasistencias,
  count(distinct codigo_estudiante)                                 as estudiantes,
  count(distinct lab_code)                                          as laboratorios,
  coalesce(sum(horas) filter (where estado = 'aprobada'::reservation_status), 0)
                                                                    as horas_aprobadas
from public.v_reservas_detalle
group by semestre;

-- ---------------------------------------------------------------------------
-- 3) MISMO BUG, OTROS DOS SITIOS
--    La trampa del coalesce con cadena vacía también estaba en las funciones
--    de asistencia: un perfil con full_name = '' dejaba al laboratorista viendo
--    la lista con el nombre en blanco, y el escáner confirmaba sin decir a
--    quién. Se corrigen aquí para no dejar el fallo suelto.
--    Las firmas no cambian, así que basta `create or replace` (sin DROP).
-- ---------------------------------------------------------------------------
create or replace function public.session_attendees(p_session_id uuid)
returns table (
  reservation_id uuid,
  student_id     uuid,
  full_name      text,
  email          text,
  student_code   text,
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
    select r.id,
           coalesce(r.student_ref, r.student_id),
           coalesce(nullif(btrim(st.full_name), ''),
                    nullif(btrim(p.full_name), ''),
                    nullif(btrim(r.student_name), '')),
           coalesce(nullif(btrim(st.email), ''),
                    nullif(btrim(p.email), ''),
                    nullif(btrim(r.student_email), '')),
           coalesce(nullif(btrim(st.student_code), ''),
                    nullif(btrim(r.student_code), '')),
           r.attended
    from public.reservations r
    left join public.students st on st.id = r.student_ref
    left join public.profiles p  on p.id  = r.student_id
    where r.session_id = p_session_id
      and r.status = 'aprobada'::reservation_status
    order by 3 nulls last, 4;
end;
$$;

create or replace function public.mark_attendance_by_code(
  p_session_id   uuid,
  p_student_code text
)
returns table (
  ok             boolean,
  motivo         text,
  reservation_id uuid,
  full_name      text,
  student_code   text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_antelacion    constant interval := interval '30 minutes';
  v_code          text := regexp_replace(coalesce(p_student_code, ''), '[^0-9]', '', 'g');
  v_lab_id        uuid;
  v_start_instant timestamptz;
  v_res           record;
begin
  if v_code = '' then
    raise exception 'Código de barras ilegible';
  end if;

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

  select r.id, r.attended,
         coalesce(nullif(btrim(st.full_name), ''),
                  nullif(btrim(p.full_name), ''),
                  nullif(btrim(r.student_name), ''))        as nombre,
         coalesce(nullif(btrim(st.student_code), ''),
                  nullif(btrim(r.student_code), ''))        as codigo
    into v_res
  from public.reservations r
  left join public.students st on st.id = r.student_ref
  left join public.profiles p  on p.id  = r.student_id
  where r.session_id = p_session_id
    and r.status = 'aprobada'::reservation_status
    and coalesce(nullif(btrim(st.student_code), ''),
                 nullif(btrim(r.student_code), '')) = v_code
  limit 1;

  if not found then
    return query select false, 'sin_reserva'::text, null::uuid, null::text, v_code;
    return;
  end if;

  if v_res.attended is true then
    return query select true, 'ya_marcado'::text, v_res.id, v_res.nombre, v_res.codigo;
    return;
  end if;

  update public.reservations
     set attended = true, updated_at = now()
   where id = v_res.id;

  return query select true, 'marcado'::text, v_res.id, v_res.nombre, v_res.codigo;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Permisos (RLS sigue filtrando fila por fila)
-- ---------------------------------------------------------------------------
grant select on public.v_reservas_detalle  to authenticated;
grant select on public.v_semestre_resumen to authenticated;
grant execute on function public.session_attendees(uuid)              to authenticated;
grant execute on function public.mark_attendance_by_code(uuid, text)  to authenticated;

-- ============================================================================
-- Verificación sugerida (como jefe):
--   select semestre, solicitudes, aprobadas, asistencias, horas_aprobadas
--     from public.v_semestre_resumen order by semestre desc;
--
--   select * from public.v_reservas_detalle order by session_date desc limit 10;
-- ============================================================================
