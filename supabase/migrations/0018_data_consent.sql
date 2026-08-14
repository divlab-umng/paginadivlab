-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0018_data_consent.sql — AUTORIZACIÓN DE TRATAMIENTO DE DATOS
-- ----------------------------------------------------------------------------
-- POR QUÉ
--   Ley 1581 de 2012 y Decreto 1377 de 2013. La obligación NO nace de que haya
--   cuentas o contraseñas, sino de que se traten datos personales. Aunque el
--   estudiante ya no inicie sesión, el sistema guarda de personas identificables:
--   nombre, correo institucional, código estudiantil, a qué laboratorio entró,
--   cuándo, con quién y si asistió. Eso es tratamiento de datos personales.
--   Además la base vive en Supabase (EE.UU.), lo que activa lo de transmisión
--   internacional, y la UMNG es entidad pública, con estándar más exigente.
--
-- EL CASO DELICADO: LOS GRUPOS
--   Quien arma el grupo escribe el nombre y el código de hasta cuatro compañeros
--   que no están presentes. Por eso se distingue explícitamente:
--     consent_self = true  → el titular autorizó él mismo, al enviar el formulario
--     consent_self = false → un tercero (el líder) declaró tener su autorización
--   Esa distinción es la que permite responder con precisión ante un reclamo, y
--   se complementa con el correo que ya recibe cada integrante avisándole que fue
--   incluido y permitiéndole cancelar su cupo.
--
-- QUÉ NO HACE ESTA MIGRACIÓN
--   No sustituye la asesoría jurídica. La política publicada debe ser revisada y
--   aprobada por el área de protección de datos de la UMNG, y la base debe
--   inscribirse en el RNBD de la SIC si aplica.
--
-- Idempotente.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. Registro del consentimiento
-- ============================================================================
alter table public.reservations
  add column if not exists consent_version     text,
  add column if not exists consent_accepted_at timestamptz,
  add column if not exists consent_self        boolean;

comment on column public.reservations.consent_version is
  'Versión de la política de tratamiento aceptada al reservar.';
comment on column public.reservations.consent_self is
  'true = el titular autorizó directamente; false = el líder del grupo declaró tener su autorización.';

-- En el registro canónico queda la última aceptación propia de cada persona.
alter table public.students
  add column if not exists consent_version     text,
  add column if not exists consent_accepted_at timestamptz;

-- ============================================================================
-- 2. Solicitud con autorización obligatoria
-- ----------------------------------------------------------------------------
-- Cambia la firma (entra p_consent_version), y `create or replace` con distinto
-- número de argumentos crearía una SOBRECARGA en vez de reemplazar. DROP primero.
-- ============================================================================
drop function if exists public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb);

create or replace function public.request_group_reservations_public(
  p_session_ids     uuid[],
  p_subject_id      uuid,
  p_leader_name     text,
  p_leader_email    text,
  p_leader_code     text,
  p_members         jsonb default '[]'::jsonb,
  p_consent_version text default null
)
returns table (
  session_id uuid,
  ok         boolean,
  group_id   uuid,
  creadas    integer,
  error      text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ventana_dias constant integer  := 28;              -- 4 semanas
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
begin
  -- 2.1 Sin autorización no hay reserva. Se valida en el servidor, no solo en
  --     la casilla del formulario, que cualquiera puede saltarse.
  if v_consent is null then
    raise exception 'Debes autorizar el tratamiento de tus datos personales para reservar';
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

      -- ── Líder: autoriza en primera persona ───────────────────────────────
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
        (session_id, student_id, student_ref, subject_id, group_id, is_group_leader,
         student_name, student_email, student_code, status,
         consent_version, consent_accepted_at, consent_self)
      values
        (v_sid, null, v_est, p_subject_id, v_grupo, (v_tam > 1),
         v_student.full_name, v_student.email, v_student.student_code,
         'pendiente'::reservation_status,
         v_consent, now(), true);
      v_creadas := v_creadas + 1;

      -- ── Compañeros: la autorización la declara el líder ──────────────────
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
          (session_id, student_id, student_ref, subject_id, group_id, is_group_leader,
           student_name, student_email, student_code, status,
           consent_version, consent_accepted_at, consent_self)
        values
          (v_sid, null, v_est, p_subject_id, v_grupo, false,
           v_student.full_name, v_student.email, v_student.student_code,
           'pendiente'::reservation_status,
           v_consent, now(), false);   -- false: autorización declarada por un tercero
        v_creadas := v_creadas + 1;
      end loop;

      session_id := v_sid; ok := true; group_id := v_grupo;
      creadas := v_creadas; error := null;
      return next;

    exception when others then
      session_id := v_sid; ok := false; group_id := null;
      creadas := 0; error := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

grant execute on function public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text)
  to anon, authenticated;

-- ============================================================================
-- 3. Auditoría del consentimiento en el reporte del jefe
-- ----------------------------------------------------------------------------
-- Las columnas nuevas van AL FINAL: `create or replace view` solo permite
-- añadir al final (ver trampa documentada en la 0016).
-- ============================================================================
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
  r.cancelled_at                                           as cancelada_en,
  r.group_id,
  case when r.group_id is null then 'Individual'
       when r.is_group_leader  then 'Líder'
       else 'Integrante' end                               as rol_en_grupo,
  r.consent_version                                        as politica_version,
  r.consent_accepted_at                                    as autorizado_en,
  case when r.consent_self is null  then null
       when r.consent_self          then 'Titular'
       else 'Declarada por el grupo' end                   as autorizacion
from public.reservations r
join      public.block_sessions bs  on bs.id  = r.session_id
join      public.laboratories   l   on l.id   = bs.lab_id
left join public.students       st  on st.id  = r.student_ref
left join public.profiles       p   on p.id   = r.student_id
left join public.subjects       sub on sub.id = r.subject_id
left join public.profiles       dec on dec.id = r.decided_by;

grant select on public.v_reservas_detalle to authenticated;

-- ============================================================================
-- VERIFICACIÓN SUGERIDA
--   select codigo_estudiante, autorizacion, politica_version, autorizado_en
--     from public.v_reservas_detalle
--    order by autorizado_en desc nulls last limit 10;
-- ============================================================================
