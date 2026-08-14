-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0011_calendar_booking.sql — FASE 2: calendario semanal
-- ----------------------------------------------------------------------------
-- Aporta las dos piezas de servidor que necesita el calendario del estudiante:
--   1) lab_sessions_public()      → lee las franjas publicadas de un lab, con cupo.
--   2) request_reservations_public() → crea VARIAS reservas en una sola solicitud.
--
-- REGLAS DE NEGOCIO (confirmadas con la División de Laboratorios, agosto 2026):
--   · Ventana de reserva ....... 4 semanas (28 días) hacia adelante.
--   · Antelación mínima ........ 24 horas antes del inicio del bloque.
--   · Selección múltiple ....... el estudiante puede pedir varias franjas a la vez.
--   Los tres valores viven en constantes al inicio de cada función para que
--   cambiarlos sea una edición de una línea.
--
-- ZONA HORARIA (repetido a propósito, es la fuente de bugs #1 de este proyecto):
--   block_sessions guarda session_date (date) + start_time (time SIN zona) como
--   "reloj de pared" de Colombia, y el servidor corre en UTC. Para comparar con
--   now() hay que convertir SIEMPRE:
--       (session_date + start_time) at time zone 'America/Bogota'
--
-- TOLERANCIA A FALLOS PARCIALES:
--   Si el estudiante elige 3 franjas y una se llena mientras decide, NO se pierde
--   la solicitud completa. Cada franja se procesa en su propio bloque
--   BEGIN/EXCEPTION (subtransacción): las que sí caben se crean y las que fallan
--   se devuelven con su motivo, para mostrarlo en pantalla.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. LECTURA DEL CALENDARIO
-- ----------------------------------------------------------------------------
-- Materializa las sesiones del rango (idempotente) y las devuelve con el cupo
-- disponible ya calculado. Un solo viaje desde el navegador.
-- Recorta el rango a la ventana permitida para no exponer fechas fuera de regla.
-- ============================================================================
create or replace function public.lab_sessions_public(
  p_lab_code text,
  p_from     date,
  p_to       date
)
returns table (
  session_id   uuid,
  session_date date,
  start_time   time,
  end_time     time,
  capacity     integer,
  reserved     integer,
  disponibles  integer,
  reservable   boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ventana_dias   constant integer  := 28;  -- 4 semanas
  c_antelacion     constant interval := interval '24 hours';
  v_lab_id uuid;
  v_from   date;
  v_to     date;
begin
  select l.id into v_lab_id
    from public.laboratories l
   where l.code = p_lab_code and l.is_active;

  if v_lab_id is null then
    raise exception 'Laboratorio no encontrado o inactivo';
  end if;

  -- Recorte a la ventana permitida (nunca antes de hoy ni más allá de 4 semanas).
  v_from := greatest(p_from, current_date);
  v_to   := least(p_to,   current_date + c_ventana_dias);

  if v_from > v_to then
    return;  -- rango vacío: la semana pedida está fuera de la ventana
  end if;

  -- Materializa las sesiones de esas fechas (no duplica: on conflict do nothing).
  perform public.ensure_sessions(v_lab_id, v_from, v_to);

  return query
    select bs.id,
           bs.session_date,
           bs.start_time,
           bs.end_time,
           bs.capacity,
           bs.reserved_count,
           greatest(bs.capacity - bs.reserved_count, 0),
           -- Reservable = abierta, con cupo y con al menos 24 h de antelación.
           (bs.status = 'abierta'::session_status
             and bs.reserved_count < bs.capacity
             and ((bs.session_date + bs.start_time) at time zone 'America/Bogota')
                   >= now() + c_antelacion)
      from public.block_sessions bs
     where bs.lab_id = v_lab_id
       and bs.session_date between v_from and v_to
     order by bs.session_date, bs.start_time;
end;
$$;

-- ============================================================================
-- 2. SOLICITUD EN LOTE (varias franjas en una sola confirmación)
-- ----------------------------------------------------------------------------
-- Devuelve una fila por franja pedida, con ok = true/false y el motivo del fallo.
-- El estudiante canónico (tabla students) se resuelve UNA sola vez, antes del
-- bucle: si sus datos están mal, no tiene sentido intentar ninguna franja.
-- ============================================================================
create or replace function public.request_reservations_public(
  p_session_ids   uuid[],
  p_subject_id    uuid,
  p_student_name  text,
  p_student_email text,
  p_student_code  text
)
returns table (
  session_id     uuid,
  ok             boolean,
  reservation_id uuid,
  error          text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ventana_dias constant integer  := 28;             -- 4 semanas
  c_antelacion   constant interval := interval '24 hours';
  c_max_franjas  constant integer  := 10;             -- tope defensivo por solicitud
  v_student_id uuid;
  v_student    public.students;
  v_ids        uuid[];
  v_sid        uuid;
  v_session    public.block_sessions;
  v_holds      integer;
  v_res_id     uuid;
begin
  -- 2.1 Normaliza la lista: sin nulos y sin repetidos.
  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_session_ids, '{}'::uuid[])) as t(x)
   where x is not null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'No seleccionaste ninguna franja horaria';
  end if;
  if array_length(v_ids, 1) > c_max_franjas then
    raise exception 'Puedes solicitar máximo % franjas por solicitud', c_max_franjas;
  end if;

  -- 2.2 Resuelve (o crea) al estudiante canónico. Valida código, nombre y correo.
  v_student_id := public.upsert_student(p_student_code, p_student_name, p_student_email);
  select * into v_student from public.students where id = v_student_id;

  -- 2.3 Procesa cada franja de forma independiente.
  foreach v_sid in array v_ids
  loop
    begin
      -- Bloqueo pesimista: serializa a quienes compiten por el último cupo.
      select * into v_session from public.block_sessions where id = v_sid for update;
      if not found then
        raise exception 'La franja ya no existe';
      end if;

      -- La sesión debe pertenecer a un lab habilitado por la materia elegida.
      if not exists (
        select 1 from public.subject_labs sl
         where sl.lab_id = v_session.lab_id
           and sl.subject_id = p_subject_id
      ) then
        raise exception 'La materia seleccionada no habilita este laboratorio';
      end if;

      if v_session.status <> 'abierta'::session_status then
        raise exception 'La franja no está disponible';
      end if;

      -- Ventana de 4 semanas.
      if v_session.session_date > current_date + c_ventana_dias then
        raise exception 'Solo puedes reservar hasta 4 semanas por adelantado';
      end if;

      -- Antelación mínima de 24 horas (hora de Colombia).
      if ((v_session.session_date + v_session.start_time) at time zone 'America/Bogota')
           < now() + c_antelacion then
        raise exception 'Debes reservar con al menos 24 horas de anticipación';
      end if;

      -- Anti-duplicado por estudiante canónico.
      if exists (
        select 1 from public.reservations r
         where r.session_id = v_sid
           and r.student_ref = v_student_id
           and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
      ) then
        raise exception 'Ya tienes una reserva activa para esta franja';
      end if;

      -- Aforo, sin sobrecupo.
      select count(*) into v_holds
        from public.reservations r
       where r.session_id = v_sid
         and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status);

      if v_holds >= v_session.capacity then
        raise exception 'Ya no hay cupo en esta franja';
      end if;

      insert into public.reservations
        (session_id, student_id, student_ref, subject_id,
         student_name, student_email, student_code, status)
      values
        (v_sid, null, v_student_id, p_subject_id,
         v_student.full_name, v_student.email, v_student.student_code,
         'pendiente'::reservation_status)
      returning id into v_res_id;

      session_id := v_sid; ok := true; reservation_id := v_res_id; error := null;
      return next;

    exception when others then
      -- Falla solo esta franja (subtransacción); las demás continúan.
      session_id := v_sid; ok := false; reservation_id := null; error := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

-- ============================================================================
-- 3. PERMISOS
-- ============================================================================
grant execute on function public.lab_sessions_public(text, date, date)                      to anon, authenticated;
grant execute on function public.request_reservations_public(uuid[], uuid, text, text, text) to anon, authenticated;

-- ============================================================================
-- 4. VERIFICACIÓN SUGERIDA
-- ----------------------------------------------------------------------------
-- Franjas publicadas de Automatización en los próximos 14 días:
--   select * from public.lab_sessions_public('AUTOMATIZACION_CONTROL',
--                                            current_date, current_date + 14);
--
-- Si 'reservable' sale false en todas, revisa: (a) que el laboratorista haya
-- creado bloques para ese lab, (b) que la fecha cumpla las 24 h de antelación.
-- ============================================================================
