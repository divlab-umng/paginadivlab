-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0021_notification_targets.sql — AVISO AL LABORATORISTA
-- ----------------------------------------------------------------------------
-- EL HUECO QUE TAPA
--   Hasta ahora solo se enviaba correo al ESTUDIANTE (al solicitar y al recibir
--   la decisión). El laboratorista no se enteraba de nada: tenía que entrar al
--   panel a mirar si había solicitudes nuevas. Para una plataforma cuyo punto es
--   quitar trabajo manual, eso es un olvido serio.
--
-- POR QUÉ HACE FALTA UN RPC Y NO UNA CONSULTA NORMAL
--   El estudiante reserva SIN sesión, con el rol `anon`. Ese rol no puede leer
--   `lab_admins` ni `profiles` (y así debe seguir). Este RPC corre como
--   SECURITY DEFINER para resolver los destinatarios.
--
-- CÓMO SE EVITA QUE SIRVA PARA ENUMERAR CORREOS DEL PERSONAL
--   Recibe los UUID de las reservas recién creadas. Sin esos identificadores no
--   devuelve nada, y un UUID no se adivina: solo los tiene quien acaba de
--   reservar. No acepta filtros por laboratorio ni listados abiertos, justamente
--   para que no se pueda barrer la tabla de personal.
--
-- Idempotente.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. La solicitud ahora devuelve los IDs de las reservas creadas
-- ----------------------------------------------------------------------------
-- Sin esto, la Server Action no sabría a qué reservas se refiere y tendría que
-- identificar la notificación por session_id. Y eso NO sirve: los session_id son
-- públicos (los devuelve lab_sessions_public a cualquiera que abra el
-- calendario), así que cualquiera podría pedir los correos del personal de todos
-- los laboratorios. Los reservation_id, en cambio, solo los conoce quien acaba
-- de reservar.
--
-- Cambia el tipo de retorno → DROP obligatorio antes de recrear.
-- ============================================================================
drop function if exists public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text, uuid);

create or replace function public.request_group_reservations_public(
  p_session_ids     uuid[],
  p_subject_id      uuid,
  p_leader_name     text,
  p_leader_email    text,
  p_leader_code     text,
  p_members         jsonb default '[]'::jsonb,
  p_consent_version text default null,
  p_program_id      uuid default null
)
returns table (
  session_id      uuid,
  ok              boolean,
  group_id        uuid,
  creadas         integer,
  error           text,
  reservation_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ventana_dias constant integer  := 28;
  c_antelacion   constant interval := interval '24 hours';
  c_max_franjas  constant integer  := 10;
  c_max_filas    constant integer  := 40;

  v_consent    text := nullif(btrim(coalesce(p_consent_version, '')), '');
  v_ids        uuid[];
  v_sid        uuid;
  v_session    public.block_sessions;
  v_lab        public.laboratories;
  v_grupo      uuid;
  v_personas   integer;
  v_puestos    integer;
  v_creadas    integer;
  v_tam        integer;
  v_miembros   jsonb;
  v_m          jsonb;
  v_est        uuid;
  v_student    public.students;
  v_res_ids    uuid[];
  v_new_id     uuid;
begin
  if v_consent is null then
    raise exception 'Debes autorizar el tratamiento de tus datos personales para reservar';
  end if;

  if p_program_id is not null and not exists (
    select 1 from public.subject_programs sp
     where sp.subject_id = p_subject_id and sp.program_id = p_program_id
  ) then
    raise exception 'La materia seleccionada no corresponde a tu carrera';
  end if;

  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_session_ids, '{}'::uuid[])) as t(x)
   where x is not null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'No seleccionaste ninguna franja horaria';
  end if;
  if array_length(v_ids, 1) > c_max_franjas then
    raise exception 'Puedes solicitar máximo % franjas por solicitud', c_max_franjas;
  end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_miembros
  from (
    select distinct on (regexp_replace(m ->> 'codigo', '[^0-9]', '', 'g')) m
    from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) as m
    where regexp_replace(m ->> 'codigo', '[^0-9]', '', 'g')
          <> regexp_replace(coalesce(p_leader_code, ''), '[^0-9]', '', 'g')
  ) s;

  v_tam := 1 + jsonb_array_length(v_miembros);

  if array_length(v_ids, 1) * v_tam > c_max_filas then
    raise exception 'Demasiadas reservas de una vez (% franjas × % personas). Divide la solicitud.',
      array_length(v_ids, 1), v_tam;
  end if;

  foreach v_sid in array v_ids
  loop
    begin
      v_res_ids := '{}'::uuid[];

      select * into v_session from public.block_sessions where id = v_sid for update;
      if not found then raise exception 'La franja ya no existe'; end if;

      select * into v_lab from public.laboratories where id = v_session.lab_id;

      if v_tam > greatest(coalesce(v_lab.max_group_size, 1), 1) then
        if coalesce(v_lab.max_group_size, 1) <= 1 then
          raise exception 'Este laboratorio no admite grupos: cada estudiante reserva individualmente';
        else
          raise exception 'Este laboratorio admite grupos de máximo % personas', v_lab.max_group_size;
        end if;
      end if;

      if not exists (
        select 1 from public.subject_labs sl
         where sl.lab_id = v_session.lab_id and sl.subject_id = p_subject_id
      ) then
        raise exception 'La materia seleccionada no habilita este laboratorio';
      end if;

      if v_session.status <> 'abierta'::session_status then
        raise exception 'La franja no está disponible';
      end if;
      if v_session.session_date > current_date + c_ventana_dias then
        raise exception 'Solo puedes reservar hasta 4 semanas por adelantado';
      end if;
      if ((v_session.session_date + v_session.start_time) at time zone 'America/Bogota')
           < now() + c_antelacion then
        raise exception 'Debes reservar con al menos 24 horas de anticipación';
      end if;

      select o.personas, o.puestos into v_personas, v_puestos
        from public.session_occupancy(v_sid) o;

      if v_personas + v_tam > v_session.capacity then
        raise exception 'No hay aforo suficiente: quedan % cupos y son % personas',
          greatest(v_session.capacity - v_personas, 0), v_tam;
      end if;

      if v_session.workstations is not null
         and v_puestos + 1 > v_session.workstations then
        raise exception 'No quedan puestos de trabajo disponibles en esta franja';
      end if;

      v_grupo := case when v_tam > 1 then gen_random_uuid() else null end;
      v_creadas := 0;

      v_est := public.upsert_student(p_leader_code, p_leader_name, p_leader_email);
      select * into v_student from public.students where id = v_est;

      update public.students
         set consent_version = v_consent, consent_accepted_at = now()
       where id = v_est;

      if exists (
        select 1 from public.reservations r
         where r.session_id = v_sid and r.student_ref = v_est
           and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
      ) then
        raise exception 'Ya tienes una reserva activa para esta franja';
      end if;

      insert into public.reservations
        (session_id, student_id, student_ref, subject_id, program_id, group_id, is_group_leader,
         student_name, student_email, student_code, status,
         consent_version, consent_accepted_at, consent_self)
      values
        (v_sid, null, v_est, p_subject_id, p_program_id, v_grupo, (v_tam > 1),
         v_student.full_name, v_student.email, v_student.student_code,
         'pendiente'::reservation_status,
         v_consent, now(), true)
      returning id into v_new_id;
      v_res_ids := v_res_ids || v_new_id;
      v_creadas := v_creadas + 1;

      for v_m in select * from jsonb_array_elements(v_miembros)
      loop
        v_est := public.upsert_student(
          v_m ->> 'codigo', v_m ->> 'nombre', v_m ->> 'correo'
        );
        select * into v_student from public.students where id = v_est;

        if exists (
          select 1 from public.reservations r
           where r.session_id = v_sid and r.student_ref = v_est
             and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
        ) then
          raise exception 'El estudiante % ya tiene una reserva activa en esta franja',
            v_student.full_name;
        end if;

        insert into public.reservations
          (session_id, student_id, student_ref, subject_id, program_id, group_id, is_group_leader,
           student_name, student_email, student_code, status,
           consent_version, consent_accepted_at, consent_self)
        values
          (v_sid, null, v_est, p_subject_id, p_program_id, v_grupo, false,
           v_student.full_name, v_student.email, v_student.student_code,
           'pendiente'::reservation_status,
           v_consent, now(), false)
        returning id into v_new_id;
        v_res_ids := v_res_ids || v_new_id;
        v_creadas := v_creadas + 1;
      end loop;

      session_id := v_sid; ok := true; group_id := v_grupo;
      creadas := v_creadas; error := null; reservation_ids := v_res_ids;
      return next;

    exception when others then
      session_id := v_sid; ok := false; group_id := null;
      creadas := 0; error := sqlerrm; reservation_ids := '{}'::uuid[];
      return next;
    end;
  end loop;
end;
$$;

grant execute on function public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text, uuid)
  to anon, authenticated;

-- ============================================================================
-- 2. Destinatarios del aviso
-- ============================================================================
create or replace function public.reservation_notification_targets(
  p_reservation_ids uuid[]
)
returns table (
  admin_email   text,
  admin_name    text,
  lab_code      text,
  lab_name      text,
  session_date  date,
  start_time    time,
  end_time      time,
  student_name  text,
  student_code  text,
  subject_name  text,
  en_grupo      boolean
)
language sql
security definer
set search_path = public
as $$
  select distinct
    p.email,
    nullif(btrim(p.full_name), ''),
    l.code,
    l.name,
    bs.session_date,
    bs.start_time,
    bs.end_time,
    coalesce(nullif(btrim(st.full_name), ''), nullif(btrim(r.student_name), '')),
    coalesce(nullif(btrim(st.student_code), ''), nullif(btrim(r.student_code), '')),
    sub.name,
    (r.group_id is not null)
  from public.reservations r
  join public.block_sessions bs on bs.id = r.session_id
  join public.laboratories   l  on l.id  = bs.lab_id
  -- Solo los laboratoristas asignados a ESE laboratorio.
  join public.lab_admins     la on la.lab_id = bs.lab_id
  join public.profiles       p  on p.id = la.admin_id and p.role = 'laboratorista'
  left join public.students  st  on st.id  = r.student_ref
  left join public.subjects  sub on sub.id = r.subject_id
  where r.id = any (coalesce(p_reservation_ids, '{}'::uuid[]))
    and nullif(btrim(p.email), '') is not null
  order by l.name, bs.session_date, bs.start_time, 8;
$$;

grant execute on function public.reservation_notification_targets(uuid[]) to anon, authenticated;

-- ============================================================================
-- VERIFICACIÓN
--   Con una reserva recién creada:
--     select * from public.reservation_notification_targets(array['<uuid>']::uuid[]);
--   Con un uuid inventado debe devolver 0 filas.
-- ============================================================================
