-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0016_work_groups.sql — FASE 6: grupos de trabajo y puestos
-- ----------------------------------------------------------------------------
-- EL PROBLEMA
--   Hasta ahora el sistema modelaba UN solo recurso: personas (`capacity`).
--   Pero en labs como Metales o CIM compiten DOS recursos independientes:
--       · aforo   → 20 personas caben en el espacio
--       · puestos → solo hay 10 mesas / tornos / celdas de manufactura
--   Un grupo de 4 estudiantes consume 4 de aforo pero UN solo puesto. Sin
--   modelar esa segunda restricción, el sistema podía aprobar 20 personas para
--   10 tornos y media práctica se quedaba sin equipo.
--
-- EL MODELO: UNA FILA POR PERSONA, CON `group_id` COMPARTIDO
--   Se conserva una reserva por estudiante y se les pone un group_id común.
--   La alternativa (una reserva "del grupo" con los compañeros en tabla hija)
--   rompería tres cosas que ya funcionan:
--     · el ESCÁNER cruza el carné contra reservations.student_code — si solo el
--       líder tuviera fila, los demás no existirían para el lector;
--     · las MÉTRICAS por estudiante (v_student_lab_hours) cuentan por reserva;
--     · el AFORO ATÓMICO: reserved_count cuenta filas activas.
--   Con group_id nada de eso cambia:
--       personas = count(*)
--       puestos  = count(distinct group_id) + count(*) donde group_id is null
--   Y sale gratis una propiedad útil: si todos los integrantes cancelan, el
--   group_id desaparece del conteo y el puesto se libera solo. Si cancela uno,
--   el grupo conserva su mesa.
--
-- OPCIONAL POR LABORATORIO (esto es lo que lo hace viable)
--   workstations = NULL      → sin límite de puestos (los ~45 labs que no lo
--                              necesitan se comportan EXACTAMENTE igual que hoy)
--   max_group_size NULL o 1  → el lab no admite grupos, solo reservas individuales
--
-- REGLAS CONFIRMADAS CON LA DIVISIÓN (agosto 2026)
--   · Aprobación INDIVIDUAL: el laboratorista decide estudiante por estudiante,
--     no el grupo completo de una vez. Así puede rechazar a uno (p. ej. le falta
--     la inducción de seguridad) sin tumbar la práctica de los demás.
--   · Cancelación con DOS opciones: cualquier integrante cancela su propio cupo;
--     la cancelación del grupo completo queda reservada a quien lo creó.
--
-- Idempotente. Aplicar en el SQL Editor de Supabase.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. ESQUEMA
-- ============================================================================

-- 1.1 La reserva puede pertenecer a un grupo de trabajo.
--     group_id NULL = reserva individual (comportamiento histórico).
alter table public.reservations
  add column if not exists group_id        uuid,
  add column if not exists is_group_leader boolean not null default false;

create index if not exists idx_reservations_group on public.reservations (group_id);

-- 1.2 Política de grupos del laboratorio.
alter table public.laboratories
  add column if not exists max_group_size integer
    check (max_group_size is null or max_group_size between 1 and 20);

comment on column public.laboratories.max_group_size is
  'Máximo de integrantes por grupo. NULL o 1 = el lab no admite grupos.';

-- 1.3 Puestos de trabajo. Vive junto a `capacity` y sigue su mismo patrón:
--     se define en el bloque y se denormaliza en la sesión, para que la
--     validación ocurra sobre la fila que ya se bloquea con FOR UPDATE.
alter table public.schedule_blocks
  add column if not exists workstations integer check (workstations is null or workstations > 0);

alter table public.block_sessions
  add column if not exists workstations integer check (workstations is null or workstations > 0);

comment on column public.schedule_blocks.workstations is
  'Puestos/equipos disponibles en el bloque. NULL = sin límite de puestos.';

-- 1.4 Backfill: sesiones ya materializadas heredan los puestos de su bloque.
update public.block_sessions bs
   set workstations = sb.workstations
  from public.schedule_blocks sb
 where sb.id = bs.block_id
   and bs.workstations is distinct from sb.workstations;

-- ============================================================================
-- 2. ensure_sessions() — ahora propaga `workstations`
-- ============================================================================
create or replace function public.ensure_sessions(p_lab_id uuid, p_from date, p_to date)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.block_sessions
    (block_id, lab_id, session_date, start_time, end_time, capacity, workstations, status)
  select b.id, b.lab_id, g.d::date, b.start_time, b.end_time, b.capacity, b.workstations, 'abierta'
    from public.schedule_blocks b
    cross join generate_series(p_from, p_to, interval '1 day') as g(d)
   where b.lab_id = p_lab_id
     and b.is_active
     and extract(isodow from g.d)::int = b.weekday
     and (b.valid_from  is null or g.d::date >= b.valid_from)
     and (b.valid_until is null or g.d::date <= b.valid_until)
  on conflict (block_id, session_date) do nothing;
end;
$$;

grant execute on function public.ensure_sessions(uuid, date, date) to anon, authenticated;

-- ============================================================================
-- 3. Helper: ocupación de una sesión (personas y puestos)
-- ----------------------------------------------------------------------------
-- Un puesto lo ocupa cada grupo distinto MÁS cada reserva individual.
-- count(distinct group_id) ignora los NULL por definición, por eso se suman
-- aparte las filas sin grupo.
-- ============================================================================
create or replace function public.session_occupancy(p_session_id uuid)
returns table (personas integer, puestos integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::int,
    (count(distinct r.group_id) + count(*) filter (where r.group_id is null))::int
  from public.reservations r
  where r.session_id = p_session_id
    and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status);
$$;

grant execute on function public.session_occupancy(uuid) to anon, authenticated;

-- ============================================================================
-- 4. SOLICITUD CON GRUPO DE TRABAJO
-- ----------------------------------------------------------------------------
-- p_members: arreglo JSON de compañeros, SIN incluir al líder:
--   '[{"nombre":"Ana Ruiz","correo":"ana@unimilitar.edu.co","codigo":"1234567"}]'
-- Pasar '[]' equivale a una reserva individual.
--
-- Devuelve una fila por sesión pedida (tolerante a fallos parciales, igual que
-- request_reservations_public): si una franja se llena mientras el estudiante
-- decide, las demás se crean igual.
-- ============================================================================
create or replace function public.request_group_reservations_public(
  p_session_ids   uuid[],
  p_subject_id    uuid,
  p_leader_name   text,
  p_leader_email  text,
  p_leader_code   text,
  p_members       jsonb default '[]'::jsonb
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
  c_max_filas    constant integer  := 40;              -- tope franjas × integrantes

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
  -- 4.1 Sesiones: sin nulos ni repetidas.
  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_session_ids, '{}'::uuid[])) as t(x)
   where x is not null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'No seleccionaste ninguna franja horaria';
  end if;
  if array_length(v_ids, 1) > c_max_franjas then
    raise exception 'Puedes solicitar máximo % franjas por solicitud', c_max_franjas;
  end if;

  -- 4.2 Integrantes: se descartan repetidos por código y el propio líder,
  --     que ya va incluido aparte.
  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_miembros
  from (
    select distinct on (regexp_replace(m ->> 'codigo', '[^0-9]', '', 'g')) m
    from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) as m
    where regexp_replace(m ->> 'codigo', '[^0-9]', '', 'g')
          <> regexp_replace(coalesce(p_leader_code, ''), '[^0-9]', '', 'g')
  ) s;

  v_tam := 1 + jsonb_array_length(v_miembros);  -- líder + compañeros

  if array_length(v_ids, 1) * v_tam > c_max_filas then
    raise exception 'Demasiadas reservas de una vez (% franjas × % personas). Divide la solicitud.',
      array_length(v_ids, 1), v_tam;
  end if;

  -- 4.3 Procesa cada franja de forma independiente.
  foreach v_sid in array v_ids
  loop
    begin
      -- Bloqueo pesimista: serializa a quienes compiten por el último cupo/puesto.
      select * into v_session from public.block_sessions where id = v_sid for update;
      if not found then raise exception 'La franja ya no existe'; end if;

      select * into v_lab from public.laboratories where id = v_session.lab_id;

      -- Política de grupos del laboratorio.
      if v_tam > greatest(coalesce(v_lab.max_group_size, 1), 1) then
        if coalesce(v_lab.max_group_size, 1) <= 1 then
          raise exception 'Este laboratorio no admite grupos: cada estudiante reserva individualmente';
        else
          raise exception 'Este laboratorio admite grupos de máximo % personas', v_lab.max_group_size;
        end if;
      end if;

      -- La materia debe habilitar el laboratorio.
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

      -- Ocupación actual, dentro del bloqueo.
      select o.personas, o.puestos into v_personas, v_puestos
        from public.session_occupancy(v_sid) o;

      -- Restricción 1: AFORO (personas).
      if v_personas + v_tam > v_session.capacity then
        raise exception 'No hay aforo suficiente: quedan % cupos y son % personas',
          greatest(v_session.capacity - v_personas, 0), v_tam;
      end if;

      -- Restricción 2: PUESTOS (el grupo entero ocupa UNO).
      if v_session.workstations is not null
         and v_puestos + 1 > v_session.workstations then
        raise exception 'No quedan puestos de trabajo disponibles en esta franja';
      end if;

      -- Alta del grupo.
      v_grupo := case when v_tam > 1 then gen_random_uuid() else null end;
      v_creadas := 0;

      -- Líder.
      v_est := public.upsert_student(p_leader_code, p_leader_name, p_leader_email);
      select * into v_student from public.students where id = v_est;

      if exists (
        select 1 from public.reservations r
         where r.session_id = v_sid and r.student_ref = v_est
           and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
      ) then
        raise exception 'Ya tienes una reserva activa para esta franja';
      end if;

      insert into public.reservations
        (session_id, student_id, student_ref, subject_id, group_id, is_group_leader,
         student_name, student_email, student_code, status)
      values
        (v_sid, null, v_est, p_subject_id, v_grupo, (v_tam > 1),
         v_student.full_name, v_student.email, v_student.student_code,
         'pendiente'::reservation_status);
      v_creadas := v_creadas + 1;

      -- Compañeros.
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
           student_name, student_email, student_code, status)
        values
          (v_sid, null, v_est, p_subject_id, v_grupo, false,
           v_student.full_name, v_student.email, v_student.student_code,
           'pendiente'::reservation_status);
        v_creadas := v_creadas + 1;
      end loop;

      session_id := v_sid; ok := true; group_id := v_grupo;
      creadas := v_creadas; error := null;
      return next;

    exception when others then
      -- Falla solo esta franja (subtransacción); las demás continúan.
      session_id := v_sid; ok := false; group_id := null;
      creadas := 0; error := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

grant execute on function public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb)
  to anon, authenticated;

-- ============================================================================
-- 5. CANCELACIÓN DEL GRUPO COMPLETO (solo quien lo creó)
-- ----------------------------------------------------------------------------
-- La cancelación individual sigue en cancel_reservation_public: cualquier
-- integrante puede retirarse y el grupo conserva su puesto. Aquí se cancela
-- todo el grupo de una vez, y por eso se exige ser el líder: que un integrante
-- cualquiera borre la práctica de los otros cuatro sería destructivo.
-- ============================================================================
create or replace function public.cancel_group_reservation_public(
  p_reservation_id uuid,
  p_student_code   text,
  p_student_email  text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res   public.reservations;
  v_count integer;
begin
  select * into v_res from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reserva no encontrada'; end if;

  if v_res.student_code is distinct from btrim(p_student_code)
     or lower(coalesce(v_res.student_email, '')) is distinct from lower(btrim(p_student_email)) then
    raise exception 'Los datos no coinciden con la reserva';
  end if;

  if v_res.group_id is null then
    raise exception 'Esta reserva no pertenece a un grupo';
  end if;
  if not v_res.is_group_leader then
    raise exception 'Solo quien creó el grupo puede cancelarlo completo. Puedes cancelar tu propio cupo.';
  end if;

  update public.reservations
     set status = 'cancelada'::reservation_status, cancelled_at = now()
   where group_id = v_res.group_id
     and status in ('pendiente'::reservation_status, 'aprobada'::reservation_status);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.cancel_group_reservation_public(uuid, text, text)
  to anon, authenticated;

-- ============================================================================
-- 6. lab_sessions_public() — ahora informa también de PUESTOS
-- ----------------------------------------------------------------------------
-- Se agregan columnas al retorno, y Postgres no permite cambiar el tipo de
-- retorno con `create or replace`: hay que DROP primero y volver a otorgar el
-- GRANT, que se pierde con el DROP.
-- ============================================================================
drop function if exists public.lab_sessions_public(text, date, date);

create or replace function public.lab_sessions_public(
  p_lab_code text,
  p_from     date,
  p_to       date
)
returns table (
  session_id          uuid,
  session_date        date,
  start_time          time,
  end_time            time,
  capacity            integer,
  reserved            integer,
  disponibles         integer,
  workstations        integer,
  puestos_usados      integer,
  puestos_disponibles integer,
  max_group_size      integer,
  reservable          boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ventana_dias constant integer  := 28;
  c_antelacion   constant interval := interval '24 hours';
  v_lab_id uuid;
  v_max_grupo integer;
  v_from   date;
  v_to     date;
begin
  select l.id, l.max_group_size into v_lab_id, v_max_grupo
    from public.laboratories l
   where l.code = p_lab_code and l.is_active;

  if v_lab_id is null then
    raise exception 'Laboratorio no encontrado o inactivo';
  end if;

  v_from := greatest(p_from, current_date);
  v_to   := least(p_to,   current_date + c_ventana_dias);
  if v_from > v_to then return; end if;

  perform public.ensure_sessions(v_lab_id, v_from, v_to);

  return query
    select bs.id,
           bs.session_date,
           bs.start_time,
           bs.end_time,
           bs.capacity,
           bs.reserved_count,
           greatest(bs.capacity - bs.reserved_count, 0),
           bs.workstations,
           o.puestos,
           case when bs.workstations is null then null
                else greatest(bs.workstations - o.puestos, 0) end,
           v_max_grupo,
           (bs.status = 'abierta'::session_status
             and bs.reserved_count < bs.capacity
             and (bs.workstations is null or o.puestos < bs.workstations)
             and ((bs.session_date + bs.start_time) at time zone 'America/Bogota')
                   >= now() + c_antelacion)
      from public.block_sessions bs
      cross join lateral public.session_occupancy(bs.id) o
     where bs.lab_id = v_lab_id
       and bs.session_date between v_from and v_to
     order by bs.session_date, bs.start_time;
end;
$$;

grant execute on function public.lab_sessions_public(text, date, date) to anon, authenticated;

-- ============================================================================
-- 7. El grupo, visible donde hace falta
-- ============================================================================

-- 7.1 Consulta del estudiante: saber si su reserva es de grupo y de qué tamaño.
drop function if exists public.lookup_reservations_public(text, text);

create or replace function public.lookup_reservations_public(
  p_student_code  text,
  p_student_email text
)
returns table (
  reservation_id uuid,
  status         public.reservation_status,
  lab_code       text,
  lab_name       text,
  subject_name   text,
  session_date   date,
  start_time     time,
  end_time       time,
  created_at     timestamptz,
  group_id       uuid,
  es_lider       boolean,
  integrantes    integer
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.status, l.code, l.name, sub.name,
         bs.session_date, bs.start_time, bs.end_time, r.created_at,
         r.group_id, r.is_group_leader,
         case when r.group_id is null then 1
              else (select count(*)::int from public.reservations g
                     where g.group_id = r.group_id
                       and g.status in ('pendiente'::reservation_status,
                                        'aprobada'::reservation_status))
         end
    from public.reservations r
    join public.block_sessions bs on bs.id = r.session_id
    join public.laboratories   l  on l.id  = bs.lab_id
    left join public.subjects  sub on sub.id = r.subject_id
   where r.student_code = btrim(p_student_code)
     and lower(r.student_email) = lower(btrim(p_student_email))
   order by bs.session_date desc, bs.start_time;
$$;

grant execute on function public.lookup_reservations_public(text, text) to anon, authenticated;

-- 7.2 Reporte del jefe: el grupo en el Excel.
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
  -- Las columnas NUEVAS van AL FINAL a propósito: `create or replace view` solo
  -- permite AÑADIR columnas al final. Insertarlas en medio falla con
  -- "cannot change name of view column", y obligaría a borrar y recrear también
  -- v_semestre_resumen, que depende de esta vista.
  r.group_id,
  case when r.group_id is null then 'Individual'
       when r.is_group_leader  then 'Líder'
       else 'Integrante' end                               as rol_en_grupo
from public.reservations r
join      public.block_sessions bs  on bs.id  = r.session_id
join      public.laboratories   l   on l.id   = bs.lab_id
left join public.students       st  on st.id  = r.student_ref
left join public.profiles       p   on p.id   = r.student_id
left join public.subjects       sub on sub.id = r.subject_id
left join public.profiles       dec on dec.id = r.decided_by;

grant select on public.v_reservas_detalle to authenticated;

-- ============================================================================
-- 8. CONFIGURACIÓN POR LABORATORIO (para el panel del laboratorista)
-- ============================================================================
create or replace function public.set_lab_group_policy(
  p_lab_id         uuid,
  p_max_group_size integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_lab_admin(p_lab_id) or public.is_jefe()) then
    raise exception 'No administras este laboratorio';
  end if;
  if p_max_group_size is not null and p_max_group_size not between 1 and 20 then
    raise exception 'El tamaño de grupo debe estar entre 1 y 20';
  end if;

  update public.laboratories
     set max_group_size = p_max_group_size
   where id = p_lab_id;
end;
$$;

grant execute on function public.set_lab_group_policy(uuid, integer) to authenticated;

-- ============================================================================
-- 8.b create_schedule_block() — ahora recibe también los puestos
-- ----------------------------------------------------------------------------
-- Se agrega un parámetro. OJO: `create or replace` con distinto número de
-- argumentos NO reemplaza, crea una SOBRECARGA, y quedarían dos funciones
-- compitiendo. Por eso se elimina la anterior explícitamente.
-- ============================================================================
drop function if exists public.create_schedule_block(uuid, int, text, text, int);

create or replace function public.create_schedule_block(
  p_lab_id       uuid,
  p_weekday      int,
  p_start        text,   -- 'HH:MM' — se castea a time internamente
  p_end          text,
  p_capacity     int,
  p_workstations int default null   -- NULL = sin límite de puestos
)
returns public.schedule_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block public.schedule_blocks;
  v_start time := p_start::time;
  v_end   time := p_end::time;
  v_from  date := current_date;
  v_to    date := current_date + interval '56 days';  -- materializa 8 semanas
begin
  if not (public.is_lab_admin(p_lab_id) or public.is_jefe()) then
    raise exception 'No autorizado para gestionar horarios de este laboratorio'
      using errcode = '42501';
  end if;

  if p_weekday is null or p_weekday < 1 or p_weekday > 7 then
    raise exception 'Día de la semana inválido (1-7, ISO)';
  end if;
  if v_end <= v_start then
    raise exception 'La hora de fin debe ser posterior a la de inicio';
  end if;
  if p_capacity is null or p_capacity < 1 then
    raise exception 'El aforo debe ser al menos 1';
  end if;
  if p_workstations is not null and p_workstations < 1 then
    raise exception 'Los puestos de trabajo deben ser al menos 1';
  end if;
  if p_workstations is not null and p_workstations > p_capacity then
    raise exception 'No puede haber más puestos (%) que aforo (%)', p_workstations, p_capacity;
  end if;

  if exists (
    select 1 from public.schedule_blocks
    where lab_id = p_lab_id and weekday = p_weekday
      and start_time = v_start and is_active
  ) then
    raise exception 'Ya existe un bloque activo para ese día y hora de inicio';
  end if;

  insert into public.schedule_blocks
    (lab_id, weekday, start_time, end_time, capacity, workstations, is_active)
  values
    (p_lab_id, p_weekday, v_start, v_end, p_capacity, p_workstations, true)
  returning * into v_block;

  perform public.ensure_sessions(p_lab_id, v_from, v_to);
  return v_block;
end;
$$;

grant execute on function public.create_schedule_block(uuid, int, text, text, int, int)
  to authenticated;

-- ============================================================================
-- 9. EJEMPLO DE CONFIGURACIÓN (descomentar y ajustar a la realidad del lab)
-- ----------------------------------------------------------------------------
-- Metales: 20 personas de aforo, 10 mesas de trabajo, grupos de hasta 5.
-- ----------------------------------------------------------------------------
-- update public.laboratories set max_group_size = 5 where code = 'METALES';
-- update public.schedule_blocks set workstations = 10
--  where lab_id = (select id from public.laboratories where code = 'METALES');
-- update public.block_sessions bs set workstations = sb.workstations
--   from public.schedule_blocks sb where sb.id = bs.block_id;
--
-- Verificación:
--   select * from public.lab_sessions_public('METALES', current_date, current_date + 14);
-- ============================================================================
