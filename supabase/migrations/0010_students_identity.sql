-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0010_students_identity.sql — IDENTIDAD CANÓNICA DEL ESTUDIANTE
-- ----------------------------------------------------------------------------
-- PROBLEMA QUE RESUELVE
--   La 0009 guardaba la identidad del estudiante como TEXTO suelto en cada
--   reserva (student_name / student_email / student_code). Eso impide métricas
--   cruzadas confiables: agrupar por el texto del correo es frágil (mayúsculas,
--   alias, typos, cambio de correo) y no da una clave estable por persona.
--
-- SOLUCIÓN
--   Tabla `students` = registro canónico de personas, con `student_code` como
--   CLAVE NATURAL ÚNICA. Cada reserva apunta a esa fila (reservations.student_ref).
--   Así, "¿cuántas horas reservó este estudiante en CIM este semestre?" es un
--   GROUP BY sobre un uuid estable, no sobre texto.
--
-- HALLAZGO VERIFICADO (carné UMNG, agosto 2026)
--   El código de barras del reverso se decodificó con zxing-cpp:
--       Formato = CODE 39      Contenido = '5601330'
--   Ese valor coincide EXACTAMENTE con el "CÓDIGO" impreso al frente del carné.
--   El número largo del reverso (p. ej. 1455171579) es el consecutivo del
--   plástico (card_serial), NO va en el código de barras y NO sirve para cruzar.
--   → Escanear el carné devuelve directamente `students.student_code`.
--   → Para la Fase 4, configurar el lector SOLO en Code 39 (más rápido y con
--     menos falsos positivos que dejar todos los formatos activos).
--
-- Idempotente: IF NOT EXISTS / create or replace / on conflict do nothing.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. REGISTRO CANÓNICO DE ESTUDIANTES
-- ============================================================================
create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  -- Clave natural: el número del carné (y del código de barras Code 39).
  student_code text not null unique check (student_code ~ '^[0-9]{4,15}$'),
  full_name    text not null,
  email        text not null,
  program      text,        -- opcional: 'INGENIERIA BIOMÉDICA', etc.
  card_serial  text,        -- opcional: consecutivo del plástico (no es el del barcode)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Búsqueda por correo insensible a mayúsculas (para el seguimiento del estudiante).
create index if not exists idx_students_email_lower on public.students (lower(email));

drop trigger if exists trg_students_touch on public.students;
create trigger trg_students_touch
before update on public.students
for each row execute function public.touch_updated_at();

-- ============================================================================
-- 2. LA RESERVA APUNTA AL ESTUDIANTE CANÓNICO
-- ----------------------------------------------------------------------------
-- OJO con los dos nombres parecidos (se conservan ambos a propósito):
--   reservations.student_id  → profiles(id)  — flujo AUTENTICADO histórico.
--   reservations.student_ref → students(id)  — flujo PÚBLICO sin login (nuevo).
-- Para métricas de estudiantes usa SIEMPRE student_ref.
-- ============================================================================
alter table public.reservations
  add column if not exists student_ref uuid references public.students(id);

create index if not exists idx_reservations_student_ref on public.reservations (student_ref);

-- ============================================================================
-- 3. UPSERT DEL ESTUDIANTE (normaliza y devuelve el id canónico)
-- ----------------------------------------------------------------------------
-- Normaliza: código a solo dígitos (Code 39 puede traer '*' de inicio/fin),
-- correo a minúsculas, nombre sin espacios sobrantes.
-- Si el código ya existe, actualiza nombre/correo con el dato más reciente
-- (la gente corrige typos) pero NUNCA cambia el código: esa es la identidad.
-- ============================================================================
create or replace function public.upsert_student(
  p_student_code  text,
  p_full_name     text,
  p_student_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text := regexp_replace(coalesce(p_student_code, ''), '[^0-9]', '', 'g');
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_email text := lower(btrim(coalesce(p_student_email, '')));
  v_id    uuid;
begin
  if v_code !~ '^[0-9]{4,15}$' then
    raise exception 'El código de estudiante debe ser numérico (4 a 15 dígitos)';
  end if;
  if length(v_name) < 3 then
    raise exception 'Ingresa tu nombre completo';
  end if;
  if v_email !~* '@unimilitar\.edu\.co$' then
    raise exception 'El correo debe ser institucional @unimilitar.edu.co';
  end if;

  insert into public.students (student_code, full_name, email)
  values (v_code, v_name, v_email)
  on conflict (student_code) do update
    set full_name = excluded.full_name,
        email     = excluded.email
  returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================================
-- 4. SOLICITUD PÚBLICA v2 — ahora resuelve al estudiante canónico
-- ----------------------------------------------------------------------------
-- Reemplaza la versión de la 0009 (misma firma). Cambios:
--   - llama a upsert_student y guarda student_ref;
--   - el anti-duplicado usa el estudiante canónico, no el texto del código.
-- Conserva el control de aforo atómico (FOR UPDATE) y las validaciones.
-- ============================================================================
create or replace function public.request_reservation_public(
  p_session_id    uuid,
  p_subject_id    uuid,
  p_student_name  text,
  p_student_email text,
  p_student_code  text
)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session    public.block_sessions;
  v_holds      integer;
  v_res        public.reservations;
  v_student_id uuid;
  v_student    public.students;
begin
  -- 4.1 Resuelve (o crea) al estudiante canónico. Valida nombre, correo y código.
  --     Orden de argumentos de upsert_student: (código, nombre, correo).
  v_student_id := public.upsert_student(p_student_code, p_student_name, p_student_email);
  select * into v_student from public.students where id = v_student_id;

  -- 4.2 La sesión debe pertenecer a un laboratorio habilitado por la materia
  if not exists (
    select 1
      from public.block_sessions s
      join public.subject_labs sl on sl.lab_id = s.lab_id
     where s.id = p_session_id
       and sl.subject_id = p_subject_id
  ) then
    raise exception 'La materia seleccionada no habilita este laboratorio';
  end if;

  -- 4.3 Bloqueo pesimista de la sesión: serializa a quienes compiten por el cupo
  select * into v_session from public.block_sessions where id = p_session_id for update;
  if not found then raise exception 'La sesión no existe'; end if;
  if v_session.status <> 'abierta' then raise exception 'La sesión no está disponible'; end if;
  if v_session.session_date < current_date then raise exception 'La sesión ya finalizó'; end if;

  -- 4.4 Anti-duplicado por estudiante canónico
  if exists (
    select 1 from public.reservations
     where session_id = p_session_id
       and student_ref = v_student_id
       and status in ('pendiente', 'aprobada')
  ) then
    raise exception 'Ya tienes una reserva activa para este bloque';
  end if;

  -- 4.5 Chequeo de aforo (sin sobrecupo)
  select count(*) into v_holds from public.reservations
   where session_id = p_session_id and status in ('pendiente', 'aprobada');
  if v_holds >= v_session.capacity then
    raise exception 'No hay aforo disponible en este bloque';
  end if;

  -- 4.6 Inserta. Se conservan las columnas de texto como foto histórica del
  --     formulario, pero la verdad para métricas es student_ref.
  insert into public.reservations
    (session_id, student_id, student_ref, subject_id,
     student_name, student_email, student_code, status)
  values
    (p_session_id, null, v_student_id, p_subject_id,
     v_student.full_name, v_student.email, v_student.student_code, 'pendiente')
  returning * into v_res;

  return v_res;
end;
$$;

-- ============================================================================
-- 5. BACKFILL — reservas anónimas creadas antes de esta migración
-- ============================================================================
do $$
declare r record; v_id uuid;
begin
  for r in
    select distinct student_code, student_name, student_email
      from public.reservations
     where student_ref is null
       and student_code is not null
       and student_email is not null
       and student_name is not null
  loop
    begin
      v_id := public.upsert_student(r.student_code, r.student_name, r.student_email);
      update public.reservations
         set student_ref = v_id
       where student_ref is null and student_code = r.student_code;
    exception when others then
      raise notice 'Backfill omitido para código %: %', r.student_code, sqlerrm;
    end;
  end loop;
end $$;

-- ============================================================================
-- 6. CORRECCIÓN: session_attendees con reservas SIN login
-- ----------------------------------------------------------------------------
-- BUG: la versión de la 0008 hacía INNER JOIN a profiles por student_id. Como
-- las reservas anónimas tienen student_id NULL, esos estudiantes DESAPARECÍAN
-- de la lista de asistencia y el laboratorista no podía marcarlos.
-- Ahora: LEFT JOIN a ambos orígenes y COALESCE. Se expone student_code para
-- que la Fase 4 (escáner Code 39) pueda cruzar el escaneo con la lista.
--
-- NOTA: se agrega la columna `student_code` al retorno, y Postgres NO permite
-- cambiar el tipo de retorno con `create or replace` ("cannot change return type
-- of existing function"). Por eso hay que hacer DROP primero — y volver a
-- otorgar el permiso de ejecución, que se pierde al eliminar la función.
-- ============================================================================
drop function if exists public.session_attendees(uuid);

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
           coalesce(r.student_ref, r.student_id)                   as student_id,
           coalesce(st.full_name, p.full_name, r.student_name)     as full_name,
           coalesce(st.email,     p.email,     r.student_email)    as email,
           coalesce(st.student_code, r.student_code)               as student_code,
           r.attended
    from public.reservations r
    left join public.students st on st.id = r.student_ref
    left join public.profiles p  on p.id  = r.student_id
    where r.session_id = p_session_id
      and r.status = 'aprobada'::reservation_status
    order by 3 nulls last, 4;
end;
$$;

-- ============================================================================
-- 7. MÉTRICAS CRUZADAS — horas por estudiante / laboratorio / semestre
-- ----------------------------------------------------------------------------
-- v_student_lab_hours: grano fino (una fila por reserva) con las horas del
-- bloque ya calculadas y la etiqueta de semestre (Colombia: I = ene–jun,
-- II = jul–dic). Sirve para filtrar por rango, lab, materia o estado.
-- security_invoker → respeta RLS (el Jefe ve todo; el laboratorista, lo suyo).
-- ============================================================================
create or replace view public.v_student_lab_hours with (security_invoker = true) as
select
  st.id                as student_ref,
  st.student_code,
  st.full_name         as student_name,
  st.email             as student_email,
  l.id                 as lab_id,
  l.code               as lab_code,
  l.name               as lab_name,
  sub.name             as subject_name,
  bs.session_date,
  bs.start_time,
  bs.end_time,
  extract(year from bs.session_date)::int                                        as anio,
  (extract(year from bs.session_date)::int::text || '-' ||
     case when extract(month from bs.session_date) <= 6 then 'I' else 'II' end)  as semestre,
  round(extract(epoch from (bs.end_time - bs.start_time)) / 3600.0, 2)           as horas,
  r.status,
  r.attended,
  r.id                 as reservation_id
from public.reservations r
join public.students      st  on st.id  = r.student_ref
join public.block_sessions bs on bs.id  = r.session_id
join public.laboratories   l  on l.id   = bs.lab_id
left join public.subjects  sub on sub.id = r.subject_id;

-- 7.2 Resumen agregado: una fila por estudiante + laboratorio + semestre.
create or replace view public.v_student_lab_summary with (security_invoker = true) as
select
  student_ref,
  student_code,
  student_name,
  student_email,
  lab_code,
  lab_name,
  semestre,
  count(*) filter (where status = 'aprobada'::reservation_status)              as practicas_aprobadas,
  count(*) filter (where attended is true)                                     as practicas_asistidas,
  coalesce(sum(horas) filter (where status = 'aprobada'::reservation_status), 0) as horas_aprobadas,
  coalesce(sum(horas) filter (where attended is true), 0)                       as horas_asistidas
from public.v_student_lab_hours
group by student_ref, student_code, student_name, student_email,
         lab_code, lab_name, semestre;

-- 7.3 RPC directo: historial de un estudiante por código (para el panel del jefe
--     y, más adelante, para mostrarlo tras escanear el carné).
create or replace function public.student_lab_hours(
  p_student_code text,
  p_from         date default null,
  p_to           date default null
)
returns table (
  lab_code            text,
  lab_name            text,
  semestre            text,
  practicas_aprobadas bigint,
  horas_aprobadas     numeric,
  horas_asistidas     numeric
)
language sql
stable
-- SIN security definer a propósito: corre con los permisos de quien llama, de modo
-- que la RLS filtra sola (el jefe ve todo; el laboratorista, solo sus labs).
set search_path = public
as $$
  select v.lab_code,
         v.lab_name,
         v.semestre,
         count(*) filter (where v.status = 'aprobada'::reservation_status),
         coalesce(sum(v.horas) filter (where v.status = 'aprobada'::reservation_status), 0),
         coalesce(sum(v.horas) filter (where v.attended is true), 0)
    from public.v_student_lab_hours v
   where v.student_code = regexp_replace(coalesce(p_student_code, ''), '[^0-9]', '', 'g')
     and (p_from is null or v.session_date >= p_from)
     and (p_to   is null or v.session_date <= p_to)
   group by v.lab_code, v.lab_name, v.semestre
   order by v.semestre desc, v.lab_name;
$$;

-- ============================================================================
-- 8. RLS Y PERMISOS
-- ----------------------------------------------------------------------------
-- `students` guarda datos personales (Ley 1581): NO se expone al rol `anon`.
-- El alta ocurre solo dentro de RPCs SECURITY DEFINER.
-- ============================================================================
alter table public.students enable row level security;

-- Lectura: el Jefe ve todos; el laboratorista solo a estudiantes con reserva
-- en los labs que administra (mismo criterio que la policy de `profiles`).
drop policy if exists students_select on public.students;
create policy students_select on public.students for select using (
  public.is_jefe()
  or exists (
    select 1
      from public.reservations r
      join public.block_sessions s on s.id = r.session_id
     where r.student_ref = students.id
       and public.is_lab_admin(s.lab_id)
  )
);

-- Escritura directa: solo el Jefe (correcciones puntuales).
drop policy if exists students_write on public.students;
create policy students_write on public.students for all
  using (public.is_jefe()) with check (public.is_jefe());

grant select on public.students              to authenticated;
grant select on public.v_student_lab_hours   to authenticated;
grant select on public.v_student_lab_summary to authenticated;

grant execute on function public.upsert_student(text, text, text)      to anon, authenticated;
grant execute on function public.student_lab_hours(text, date, date)   to authenticated;

-- Re-otorgar: el DROP de la sección 6 eliminó el GRANT original de la 0008.
grant execute on function public.session_attendees(uuid)               to authenticated;

-- ============================================================================
-- 9. VERIFICACIÓN SUGERIDA (ejecutar a mano tras aplicar)
-- ----------------------------------------------------------------------------
-- Ejemplo de la pregunta que motivó esta migración:
--   select * from public.student_lab_hours('5601330');
--
-- Horas de un estudiante en CIM durante el semestre en curso:
--   select student_name, lab_code, semestre, horas_aprobadas
--     from public.v_student_lab_summary
--    where student_code = '5601330' and lab_code = 'CIM';
--
-- Ranking de estudiantes por horas en un laboratorio:
--   select student_code, student_name, sum(horas_aprobadas) as horas
--     from public.v_student_lab_summary
--    where lab_code = 'CIM' and semestre = '2026-II'
--    group by 1, 2 order by horas desc;
-- ============================================================================
