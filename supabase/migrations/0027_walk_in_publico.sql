-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0027_walk_in_publico.sql — EL ESTUDIANTE SE ANUNCIA SOLO
-- ----------------------------------------------------------------------------
-- Complementa la 0026. Con un código QR pegado en la puerta, el estudiante que
-- llega sin reserva escribe sus propios datos desde el celular y queda
-- ANUNCIADO; el laboratorista solo escanea su carné para confirmarlo.
--
-- POR QUÉ SE PARTE EN DOS Y NO SE AUTORREGISTRA TODO
--   Escribir los datos y certificar la presencia son cosas distintas.
--
--   Lo primero es trabajo mecánico y el estudiante puede hacerlo mejor que
--   nadie: son SUS datos, no los teclea mal.
--
--   Lo segundo es lo que da valor a `v_student_lab_hours` y a todo el control
--   de asistencia. Hoy lo certifica el personal: o se escanea el carné físico
--   —que exige tener la tarjeta encima— o el laboratorista lo marca. Si el
--   estudiante pudiera marcar su propia asistencia desde el celular, cualquiera
--   podría hacerlo desde su casa y la métrica dejaría de significar nada.
--
--   Un token en el QR tampoco lo resuelve: es un identificador al portador.
--   Basta que alguien fotografíe el código y lo comparta para que el grupo
--   entero se registre sin ir. Por eso NO hay token: lo público solo crea una
--   solicitud pendiente, que es exactamente el mismo riesgo que ya se acepta en
--   /reservar, y la confirmación sigue siendo presencial.
--
-- NO HACE FALTA PANTALLA NUEVA EN EL PANEL
--   `register_walk_in_attendance` ya contempla el caso: si encuentra una
--   reserva 'pendiente' o 'aprobada' del mismo código en esa sesión, la
--   convierte en asistencia en vez de duplicarla. El laboratorista escanea el
--   carné en el formulario que ya usa y listo.
--
-- IDEMPOTENTE. Reejecutable sin efectos.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) La resolución de sesión, extraída a una sola función
-- ----------------------------------------------------------------------------
-- Antes vivía dentro de `register_walk_in_attendance`. Ahora hacen falta dos
-- caminos —el del laboratorista y el del estudiante— y duplicar esta lógica en
-- ambos garantizaría que algún día se separen: alguien cambiaría la jornada del
-- comodín en un sitio y no en el otro.
--
-- Devuelve la sesión CON EL BLOQUEO YA TOMADO (`for update`). Eso es lo que
-- hace atómico el control de aforo: quien la llama cuenta y escribe sabiendo
-- que nadie más está tocando esa sesión.
--
-- No se otorga a nadie: solo la invocan funciones SECURITY DEFINER, que corren
-- como su propietario y no necesitan permiso explícito.
create or replace function public.walk_in_session(p_lab_id uuid)
returns table (
  ses_id       uuid,
  cap          integer,
  puestos_max  integer,
  inicio       time,
  fin          time,
  es_comodin   boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_inicio_jornada constant time := '06:00';
  c_fin_jornada    constant time := '22:00';
  v_ahora timestamp := (now() at time zone 'America/Bogota');
  v_hoy   date;
  v_hora  time;
  v_aforo integer;
  v_blk   uuid;
  v_ses   uuid;
begin
  v_hoy  := v_ahora::date;
  v_hora := v_ahora::time;

  select l.walk_in_capacity into v_aforo
    from public.laboratories l where l.id = p_lab_id;

  -- Primero, una sesión programada que esté ocurriendo AHORA. El aforo de un
  -- laboratorio no es abstracto: es el de la práctica en curso. Quien llega a
  -- las 11:30 entra en la sesión de 11:00–12:00, no en una paralela.
  return query
    select bs.id, bs.capacity, bs.workstations, bs.start_time, bs.end_time, false
      from public.block_sessions bs
     where bs.lab_id = p_lab_id
       and bs.session_date = v_hoy
       and bs.status = 'abierta'::session_status
       and v_hora >= bs.start_time
       and v_hora <  bs.end_time
     order by bs.start_time
     limit 1
     for update;

  if found then
    return;
  end if;

  -- Sin sesión programada: el comodín. Uno por laboratorio, `is_active = false`
  -- para que `ensure_sessions` no lo materialice y `lab_sessions_public` no lo
  -- ofrezca jamás en el calendario. `weekday` se fija en 1 porque la columna es
  -- NOT NULL con check 1..7; aquí no representa un día.
  select b.id into v_blk
    from public.schedule_blocks b
   where b.lab_id = p_lab_id and b.is_walk_in;

  if v_blk is null then
    insert into public.schedule_blocks
      (lab_id, weekday, start_time, end_time, capacity, is_active, is_walk_in)
    values
      (p_lab_id, 1, c_inicio_jornada, c_fin_jornada, v_aforo, false, true)
    returning id into v_blk;
  end if;

  insert into public.block_sessions
    (block_id, lab_id, session_date, start_time, end_time, capacity, status)
  values
    (v_blk, p_lab_id, v_hoy, c_inicio_jornada, c_fin_jornada, v_aforo, 'abierta')
  on conflict (block_id, session_date) do nothing;

  return query
    select bs.id, bs.capacity, bs.workstations, bs.start_time, bs.end_time, true
      from public.block_sessions bs
     where bs.block_id = v_blk and bs.session_date = v_hoy
     for update;
end;
$$;

revoke all on function public.walk_in_session(uuid) from public;


-- ----------------------------------------------------------------------------
-- 2) `register_walk_in_attendance` pasa a usar la función común
-- ----------------------------------------------------------------------------
-- Mismo comportamiento y misma firma que en 0026: lo único que cambia es de
-- dónde sale la sesión. Se reescribe completa porque Postgres no permite
-- sustituir solo un fragmento del cuerpo.
create or replace function public.register_walk_in_attendance(
  p_lab_code        text,
  p_student_code    text,
  p_student_name    text,
  p_student_email   text,
  p_subject_id      uuid default null,
  p_program_id      uuid default null,
  p_consent_version text default null
)
returns table (
  reservation_id   uuid,
  session_id       uuid,
  student_ref      uuid,
  es_comodin       boolean,
  ya_tenia_reserva boolean,
  cupos_restantes  integer,
  inicio           time,
  fin              time
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab      uuid;
  v_code     text;
  v_nombre   text;
  v_correo   text;
  v_s        record;
  v_personas integer;
  v_puestos  integer;
  v_est      uuid;
  v_res      uuid;
  v_previa   uuid;
begin
  select l.id into v_lab
    from public.laboratories l
   where l.code = p_lab_code and l.is_active;

  if v_lab is null then
    raise exception 'Laboratorio % no encontrado o inactivo', p_lab_code;
  end if;

  if not (public.is_lab_admin(v_lab) or public.is_jefe()) then
    raise exception 'No autorizado: no administras este laboratorio'
      using errcode = '42501';
  end if;

  v_code   := regexp_replace(coalesce(p_student_code, ''), '\D', '', 'g');
  v_nombre := nullif(btrim(coalesce(p_student_name, '')), '');
  v_correo := lower(nullif(btrim(coalesce(p_student_email, '')), ''));

  if length(v_code) = 0 then
    raise exception 'Falta el código del estudiante';
  end if;

  select * into v_s from public.walk_in_session(v_lab);

  -- Ya anunciado o ya con reserva: se confirma, no se duplica. Cubre tanto al
  -- que se registró desde el QR como al que sí había reservado y el
  -- laboratorista atiende por costumbre desde aquí.
  select r.id into v_previa
    from public.reservations r
   where r.session_id = v_s.ses_id
     and r.student_code = v_code
     and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
   limit 1;

  if v_previa is not null then
    update public.reservations
       set status        = 'aprobada'::reservation_status,
           attended      = true,
           checked_in_at = coalesce(checked_in_at, now()),
           decided_by    = coalesce(decided_by, auth.uid()),
           decided_at    = coalesce(decided_at, now())
     where id = v_previa;

    select o.personas into v_personas from public.session_occupancy(v_s.ses_id) o;

    return query
      select v_previa, v_s.ses_id, r.student_ref, v_s.es_comodin, true,
             greatest(v_s.cap - v_personas, 0), v_s.inicio, v_s.fin
        from public.reservations r where r.id = v_previa;
    return;
  end if;

  select o.personas, o.puestos into v_personas, v_puestos
    from public.session_occupancy(v_s.ses_id) o;

  if v_personas >= v_s.cap then
    raise exception
      'Aforo lleno: % de % ocupados en % (%–%). No se puede registrar la entrada.',
      v_personas, v_s.cap, p_lab_code, v_s.inicio::text, v_s.fin::text
      using errcode = 'P0001';
  end if;

  if v_s.puestos_max is not null and v_puestos >= v_s.puestos_max then
    raise exception 'Sin puestos de trabajo: % de % ocupados en %.',
      v_puestos, v_s.puestos_max, p_lab_code using errcode = 'P0001';
  end if;

  if v_nombre is null or v_correo is null then
    if not exists (select 1 from public.students s where s.student_code = v_code) then
      raise exception
        'Estudiante % no registrado: hacen falta nombre y correo institucional.',
        v_code using errcode = 'P0001';
    end if;
    select s.full_name, s.email into v_nombre, v_correo
      from public.students s where s.student_code = v_code;
  end if;

  v_est := public.upsert_student(v_code, v_nombre, v_correo);

  insert into public.reservations (
    session_id, student_id, student_ref,
    student_name, student_email, student_code,
    subject_id, program_id,
    status, attended, checked_in_at,
    decided_by, decided_at,
    consent_version, consent_accepted_at, consent_self
  ) values (
    v_s.ses_id, null, v_est,
    v_nombre, v_correo, v_code,
    p_subject_id, p_program_id,
    'aprobada'::reservation_status, true, now(),
    auth.uid(), now(),
    p_consent_version,
    case when p_consent_version is not null then now() end,
    case when p_consent_version is not null then false end
  )
  returning id into v_res;

  select o.personas into v_personas from public.session_occupancy(v_s.ses_id) o;

  return query
    select v_res, v_s.ses_id, v_est, v_s.es_comodin, false,
           greatest(v_s.cap - v_personas, 0), v_s.inicio, v_s.fin;
end;
$$;

revoke all on function public.register_walk_in_attendance(text, text, text, text, uuid, uuid, text) from public;
grant execute on function public.register_walk_in_attendance(text, text, text, text, uuid, uuid, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 3) La vía pública: el estudiante se anuncia
-- ----------------------------------------------------------------------------
-- Crea una reserva 'pendiente'. NUNCA marca asistencia ni aprueba: eso sigue
-- siendo potestad del laboratorista, que confirma escaneando el carné.
create or replace function public.request_walk_in_public(
  p_lab_code        text,
  p_student_code    text,
  p_student_name    text,
  p_student_email   text,
  p_subject_id      uuid default null,
  p_program_id      uuid default null,
  p_consent_version text default null
)
returns table (
  reservation_id uuid,
  es_comodin     boolean,
  ya_anunciado   boolean,
  lab_name       text,
  inicio         time,
  fin            time
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lab      uuid;
  v_lab_name text;
  v_code     text;
  v_nombre   text;
  v_correo   text;
  v_consent  text := nullif(btrim(coalesce(p_consent_version, '')), '');
  v_s        record;
  v_personas integer;
  v_puestos  integer;
  v_est      uuid;
  v_res      uuid;
  v_previa   uuid;
begin
  select l.id, l.name into v_lab, v_lab_name
    from public.laboratories l
   where l.code = p_lab_code and l.is_active;

  if v_lab is null then
    raise exception 'Laboratorio no encontrado o inactivo';
  end if;

  -- Mismo listón que en /reservar: sin autorización no se tratan datos.
  if v_consent is null then
    raise exception 'Debes autorizar el tratamiento de tus datos personales';
  end if;

  v_code   := regexp_replace(coalesce(p_student_code, ''), '\D', '', 'g');
  v_nombre := nullif(btrim(coalesce(p_student_name, '')), '');
  v_correo := lower(nullif(btrim(coalesce(p_student_email, '')), ''));

  if length(v_code) < 4 then
    raise exception 'Escribe el código de tu carné';
  end if;
  if v_nombre is null or length(v_nombre) < 3 then
    raise exception 'Escribe tu nombre completo';
  end if;
  if v_correo is null or v_correo !~* '^[^@\s]+@unimilitar\.edu\.co$' then
    raise exception 'Usa tu correo institucional @unimilitar.edu.co';
  end if;

  select * into v_s from public.walk_in_session(v_lab);

  -- Doble toque en el celular, o el que ya había reservado: se devuelve lo que
  -- hay en vez de un error. Para el estudiante el resultado es el mismo —está
  -- anunciado— y no se ensucia la bandeja con duplicados.
  select r.id into v_previa
    from public.reservations r
   where r.session_id = v_s.ses_id
     and r.student_code = v_code
     and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
   limit 1;

  if v_previa is not null then
    return query select v_previa, v_s.es_comodin, true, v_lab_name, v_s.inicio, v_s.fin;
    return;
  end if;

  -- El aforo se comprueba aquí también: es preferible decirle "está lleno"
  -- ahora, con el celular en la mano, que dejarlo esperando a que el
  -- laboratorista se lo diga en la puerta.
  select o.personas, o.puestos into v_personas, v_puestos
    from public.session_occupancy(v_s.ses_id) o;

  if v_personas >= v_s.cap then
    raise exception
      'El laboratorio está lleno en este momento (% de % cupos). Consulta con el laboratorista.',
      v_personas, v_s.cap using errcode = 'P0001';
  end if;

  if v_s.puestos_max is not null and v_puestos >= v_s.puestos_max then
    raise exception 'No quedan puestos de trabajo libres en este momento.'
      using errcode = 'P0001';
  end if;

  v_est := public.upsert_student(v_code, v_nombre, v_correo);

  insert into public.reservations (
    session_id, student_id, student_ref,
    student_name, student_email, student_code,
    subject_id, program_id,
    status, attended, checked_in_at,
    consent_version, consent_accepted_at, consent_self
  ) values (
    v_s.ses_id, null, v_est,
    v_nombre, v_correo, v_code,
    p_subject_id, p_program_id,
    -- Pendiente y sin asistencia: la presencia la certifica el laboratorista.
    'pendiente'::reservation_status, null, null,
    -- consent_self = true: aquí SÍ lo aceptó el titular en un formulario.
    v_consent, now(), true
  )
  returning id into v_res;

  return query select v_res, v_s.es_comodin, false, v_lab_name, v_s.inicio, v_s.fin;
end;
$$;

revoke all on function public.request_walk_in_public(text, text, text, text, uuid, uuid, text) from public;
grant execute on function public.request_walk_in_public(text, text, text, text, uuid, uuid, text)
  to anon, authenticated;


-- ============================================================================
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- El banco de pruebas `supabase/pruebas/walk_in.test.mjs` ejecuta ambos RPC
-- contra Postgres real. Esto solo confirma instalación y permisos.
-- ============================================================================
select 'funcion walk_in_session' as objeto,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='walk_in_session')
            then 'OK' else '*** FALTA ***' end as estado
union all
select 'funcion request_walk_in_public',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='request_walk_in_public')
            then 'OK' else '*** FALTA ***' end
union all
select 'register_walk_in_attendance usa walk_in_session',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='register_walk_in_attendance'
                            and pg_get_functiondef(p.oid) like '%walk_in_session%')
            then 'OK' else '*** SIN APLICAR ***' end
union all
select 'GRANT publico a anon',
       case when has_function_privilege('anon',
              'public.request_walk_in_public(text,text,text,text,uuid,uuid,text)', 'execute')
            then 'OK' else '*** FALTA ***' end
union all
select 'anon NO puede marcar asistencia',
       case when has_function_privilege('anon',
              'public.register_walk_in_attendance(text,text,text,text,uuid,uuid,text)', 'execute')
            then '*** RIESGO: anon tiene permiso ***' else 'OK' end
order by 1;
