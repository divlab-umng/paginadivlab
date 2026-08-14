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
--   · Un estudiante con el código 5601330 y su reserva ya APROBADA.
--
-- ⚠️ CAMBIA EL CÓDIGO si vas a escanear otro carné: reemplaza '5601330' por el
--    número que aparece al frente del carné que tengas a mano (las 3 apariciones).
-- ============================================================================

do $$
declare
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
    '5601330',
    'Juana Valentina Vargas Borda',
    'juana.prueba@unimilitar.edu.co'
  );

  -- 4) Reserva ya APROBADA: la asistencia solo aplica a las aprobadas.
  insert into public.reservations
    (session_id, student_ref, subject_id, student_name, student_email, student_code, status)
  values
    (v_ses, v_est, v_sub, 'Juana Valentina Vargas Borda',
     'juana.prueba@unimilitar.edu.co', '5601330', 'aprobada')
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
-- delete from public.students where student_code = '5601330';
