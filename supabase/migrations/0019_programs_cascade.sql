-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0019_programs_cascade.sql — CARRERAS y cascada de tres niveles
-- ----------------------------------------------------------------------------
-- QUÉ CAMBIA
--   Hasta ahora el filtro era de dos niveles: Materia → Laboratorio.
--   El piloto exige tres:  CARRERA → MATERIA → LABORATORIO.
--   El estudiante elige su carrera, eso filtra las materias, y la materia filtra
--   los laboratorios.
--
-- POR QUÉ N:M ENTRE MATERIA Y CARRERA (y no una columna `program_id` en subjects)
--   Una misma materia la cursan varias carreras. En el piloto, Biomédica comparte
--   las materias de Metales y CIM con Mecatrónica e Industrial. Con una sola
--   columna habría que duplicar la materia por carrera, y entonces "Procesos de
--   Mecanizado" existiría tres veces, ensuciando las métricas y el mapeo a labs.
--
-- ADEMÁS: LA CARRERA QUEDA EN LA RESERVA
--   Se agrega reservations.program_id. La carrera NO se puede deducir de la
--   materia (una materia pertenece a varias), así que si no se guarda lo que el
--   estudiante eligió, se pierde. Con ella el jefe puede responder "qué carrera
--   usa más los laboratorios", que es justo el tipo de dato que sustenta una
--   solicitud de presupuesto.
--
-- Idempotente.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. CARRERAS
-- ============================================================================
create table if not exists public.programs (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,     -- slug MAYÚSCULAS sin tildes: 'MECATRONICA'
  name       text not null,            -- visible: 'Ingeniería Mecatrónica'
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subject_programs (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (subject_id, program_id)
);

create index if not exists idx_subject_programs_program on public.subject_programs (program_id);
create index if not exists idx_subject_programs_subject on public.subject_programs (subject_id);

-- ============================================================================
-- 2. La carrera elegida queda registrada en la reserva
-- ============================================================================
alter table public.reservations
  add column if not exists program_id uuid references public.programs(id);

comment on column public.reservations.program_id is
  'Carrera que eligió el estudiante. No se deduce de la materia: una materia puede pertenecer a varias carreras.';

-- ============================================================================
-- 3. RLS y permisos
-- ----------------------------------------------------------------------------
-- Recordar la trampa nº1 del proyecto: el catálogo público debe otorgarse a
-- AMBOS roles (`anon` y `authenticated`), o falla con "permission denied"
-- justo para quien tiene sesión abierta.
-- ============================================================================
alter table public.programs         enable row level security;
alter table public.subject_programs enable row level security;

drop policy if exists programs_select on public.programs;
create policy programs_select on public.programs
  for select using (is_active or public.is_jefe());

drop policy if exists programs_write on public.programs;
create policy programs_write on public.programs
  for all using (public.is_jefe()) with check (public.is_jefe());

drop policy if exists subjectprograms_select on public.subject_programs;
create policy subjectprograms_select on public.subject_programs
  for select using (true);

drop policy if exists subjectprograms_write on public.subject_programs;
create policy subjectprograms_write on public.subject_programs
  for all using (public.is_jefe()) with check (public.is_jefe());

grant select on public.programs         to anon, authenticated;
grant select on public.subject_programs to anon, authenticated;

-- ============================================================================
-- 4. Solicitud con carrera
-- ----------------------------------------------------------------------------
-- Cambia la firma otra vez (entra p_program_id). DROP previo obligatorio: con
-- distinto número de argumentos, `create or replace` crearía una sobrecarga.
-- ============================================================================
drop function if exists public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text);

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
begin
  if v_consent is null then
    raise exception 'Debes autorizar el tratamiento de tus datos personales para reservar';
  end if;

  -- La materia debe pertenecer a la carrera elegida. Es la misma cascada que
  -- muestra el formulario, revalidada aquí: la interfaz se puede saltar.
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
         v_consent, now(), true);
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
           v_consent, now(), false);
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

grant execute on function public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text, uuid)
  to anon, authenticated;

-- ============================================================================
-- 5. La carrera, en el reporte del jefe
-- ----------------------------------------------------------------------------
-- Columna NUEVA al final (`create or replace view` solo permite añadir al final).
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
       else 'Declarada por el grupo' end                   as autorizacion,
  prog.name                                                as carrera
from public.reservations r
join      public.block_sessions bs   on bs.id   = r.session_id
join      public.laboratories   l    on l.id    = bs.lab_id
left join public.students       st   on st.id   = r.student_ref
left join public.profiles       p    on p.id    = r.student_id
left join public.subjects       sub  on sub.id  = r.subject_id
left join public.profiles       dec  on dec.id  = r.decided_by
left join public.programs       prog on prog.id = r.program_id;

grant select on public.v_reservas_detalle to authenticated;

-- ============================================================================
-- VERIFICACIÓN
--   select p.name as carrera, s.name as materia, l.code as laboratorio
--     from public.subject_programs sp
--     join public.programs p    on p.id = sp.program_id
--     join public.subjects s    on s.id = sp.subject_id
--     join public.subject_labs sl on sl.subject_id = s.id
--     join public.laboratories l on l.id = sl.lab_id
--    order by 1, 2, 3;
-- ============================================================================
