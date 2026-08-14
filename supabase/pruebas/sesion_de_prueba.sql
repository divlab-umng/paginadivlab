-- ============================================================================
-- PRUEBAS — Sesión inminente con reserva aprobada, para probar el ESCÁNER
-- ----------------------------------------------------------------------------
-- NO es una migración. No lo pongas en supabase/migrations/.
-- Pégalo en el SQL Editor de Supabase cuando quieras probar el escáner.
--
-- POR QUÉ HACE FALTA
--   El escáner solo se habilita desde 30 minutos antes del inicio de la práctica,
--   pero la regla de negocio impide reservar con menos de 24 horas de antelación.
--   O sea: no puedes crear desde la interfaz una reserva para hoy. Este script
--   arma esa situación directamente en la base de datos.
--
-- QUÉ CREA
--   · Un bloque horario de prueba en el LABORATORIO CIM.
--   · Una sesión que arranca en 5 MINUTOS y dura 2 horas (queda dentro de la
--     ventana de 30 min, así que aparece de inmediato en /panel).
--   · Un estudiante de prueba con su reserva ya APROBADA.
--
-- ⚠️ ANTES DE EJECUTARLO: pon en `v_codigo` el número que aparece AL FRENTE del
--    carné que vayas a escanear (el de arriba, no el del reverso). Es el que
--    lleva codificado el código de barras en Code 39.
--
--    Va como variable y no escrito en el cuerpo a propósito: un código de carné
--    es un dato personal y este repositorio es público.
-- ============================================================================

do $$
declare
  -- 👇 EL ÚNICO VALOR QUE DEBES CAMBIAR
  v_codigo text := '0000000';

  v_lab    uuid;
  v_sub    uuid;
  v_blk    uuid;
  v_ses    uuid;
  v_est    uuid;
  v_ahora  timestamp := (now() at time zone 'America/Bogota');
  v_inicio time      := (v_ahora + interval '5 minutes')::time;
  v_fin    time      := (v_ahora + interval '2 hours 5 minutes')::time;
begin
  select id into v_lab from public.laboratories where code = 'CIM';
  select id into v_sub from public.subjects     where code = 'AUTOMATIZACION';

  if v_codigo = '0000000' then
    raise exception 'Escribe tu código de carné en v_codigo, al inicio del bloque.';
  end if;

  if v_lab is null or v_sub is null then
    raise exception 'Falta el lab CIM o la materia AUTOMATIZACION. ¿Aplicaste 0003 y 0009?';
  end if;

  -- 1) Bloque horario en el día de la semana de hoy.
  insert into public.schedule_blocks (lab_id, weekday, start_time, end_time, capacity)
  values (v_lab, extract(isodow from v_ahora)::int, v_inicio, v_fin, 10)
  on conflict (lab_id, weekday, start_time) do update set capacity = excluded.capacity
  returning id into v_blk;

  -- 2) La sesión concreta de HOY.
  insert into public.block_sessions (block_id, lab_id, session_date, start_time, end_time, capacity)
  values (v_blk, v_lab, v_ahora::date, v_inicio, v_fin, 10)
  on conflict (block_id, session_date) do update set capacity = excluded.capacity
  returning id into v_ses;

  -- 3) Estudiante canónico (mismo código que trae el código de barras del carné).
  v_est := public.upsert_student(
    v_codigo,
    'Juana Valentina Vargas Borda',
    'juana.prueba@unimilitar.edu.co'
  );

  -- 4) Reserva ya APROBADA: la asistencia solo aplica a las aprobadas.
  insert into public.reservations
    (session_id, student_ref, subject_id, student_name, student_email, student_code, status)
  values
    (v_ses, v_est, v_sub, 'Juana Valentina Vargas Borda',
     'juana.prueba@unimilitar.edu.co', v_codigo, 'aprobada')
  on conflict do nothing;

  raise notice 'Listo. Sesión de prueba en CIM hoy de % a %.', v_inicio, v_fin;
end $$;

-- Verificación: debe aparecer con estado 'por_iniciar' (o 'en_curso' a los 5 min).
select lab_code, session_date, start_time, end_time, estado, aprobadas, marcadas
  from public.attendance_sessions()
 order by estado, start_time;


-- ============================================================================
-- LIMPIEZA — ejecútalo cuando termines de probar
-- ----------------------------------------------------------------------------
-- Borra el bloque de prueba; las sesiones y reservas se van en cascada.
-- ============================================================================
-- delete from public.schedule_blocks
--  where lab_id = (select id from public.laboratories where code = 'CIM');
--
-- delete from public.students where student_code = '1234567';
