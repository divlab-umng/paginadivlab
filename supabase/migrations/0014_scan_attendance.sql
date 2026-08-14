-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0014_scan_attendance.sql — FASE 4: asistencia por código de barras
-- ----------------------------------------------------------------------------
-- Marca la asistencia de UN estudiante a partir del número escaneado de su carné.
--
-- HALLAZGO VERIFICADO (ver 0010): el código de barras del carné UMNG es
-- CODE 39 y contiene EXACTAMENTE el código estudiantil (p. ej. '5601330'),
-- el mismo que el estudiante escribe al reservar. Por eso el cruce es directo
-- contra students.student_code y no hace falta tabla puente.
--
-- POR QUÉ UN RPC POR ESCANEO (y no acumular en el navegador)
--   El laboratorista escanea durante toda la práctica. Si se acumulara en
--   memoria y se cerrara el navegador o se apagara el celular, se perdería el
--   registro completo. Cada escaneo persiste al instante.
--   Al final, mark_session_attendance() cierra el registro marcando ausentes a
--   los que nunca se escanearon. Las dos funciones conviven sin pisarse.
--
-- VENTANA: se reutiliza la regla de la 0013 — desde 30 minutos antes del inicio.
-- ============================================================================

set search_path = public;

create or replace function public.mark_attendance_by_code(
  p_session_id   uuid,
  p_student_code text
)
returns table (
  ok             boolean,
  motivo         text,     -- 'marcado' | 'ya_marcado' | 'sin_reserva'
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
  -- Code 39 puede traer los delimitadores '*' y algún lector añade espacios:
  -- se normaliza a solo dígitos antes de comparar.
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

  -- Busca la reserva APROBADA de esa sesión cuyo estudiante tenga ese código.
  -- Se mira tanto el registro canónico (students) como la columna de la reserva,
  -- para cubrir también reservas anteriores a la tabla students.
  select r.id, r.attended,
         coalesce(st.full_name, r.student_name)     as nombre,
         coalesce(st.student_code, r.student_code)  as codigo
    into v_res
  from public.reservations r
  left join public.students st on st.id = r.student_ref
  where r.session_id = p_session_id
    and r.status = 'aprobada'::reservation_status
    and coalesce(st.student_code, r.student_code) = v_code
  limit 1;

  if not found then
    -- El carné es válido, pero esa persona no tiene cupo aprobado aquí.
    return query select false, 'sin_reserva'::text, null::uuid, null::text, v_code;
    return;
  end if;

  if v_res.attended is true then
    -- Doble escaneo del mismo carné: no es error, solo se informa.
    return query select true, 'ya_marcado'::text, v_res.id, v_res.nombre, v_res.codigo;
    return;
  end if;

  update public.reservations
     set attended = true, updated_at = now()
   where id = v_res.id;

  return query select true, 'marcado'::text, v_res.id, v_res.nombre, v_res.codigo;
end;
$$;

grant execute on function public.mark_attendance_by_code(uuid, text) to authenticated;

-- ============================================================================
-- Verificación sugerida (como laboratorista del lab, con una sesión en curso):
--   select * from public.mark_attendance_by_code('<session_id>', '5601330');
--   → motivo 'marcado' la primera vez, 'ya_marcado' la segunda.
--   select * from public.mark_attendance_by_code('<session_id>', '0000000');
--   → motivo 'sin_reserva'.
-- ============================================================================
