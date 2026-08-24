-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0026_walk_in.sql — ENTRADA INMEDIATA (WALK-IN)
-- ----------------------------------------------------------------------------
-- El estudiante que llega sin reserva. Hoy el sistema lo rechaza por la regla de
-- 24 horas de antelación, y el laboratorista termina anotándolo en un cuaderno:
-- esa práctica no existe para las métricas, ni para el control de aforo, ni para
-- el histórico del estudiante.
--
-- LA DECISIÓN DE FONDO: NO ES UN SISTEMA PARALELO
--   Un walk-in produce exactamente las mismas filas que una reserva normal —
--   `students` + `reservations` + `block_sessions`— solo que saltándose la
--   antelación y naciendo ya aprobado y con asistencia marcada. Por eso
--   `v_student_lab_hours`, el dashboard y el Excel lo cuentan sin cambiar una
--   línea: para ellos es una reserva aprobada más.
--
--   La alternativa —una tabla `walk_ins` aparte— habría obligado a modificar
--   cada vista, cada métrica y cada export, y a mantener dos definiciones de
--   "aforo" que tarde o temprano se contradicen.
--
-- CÓMO RESUELVE EL AFORO
--   Un laboratorio no tiene un aforo abstracto: tiene el de la sesión que está
--   ocurriendo. Si a las 11:30 hay una práctica de 11:00–12:00 con 18 de 20
--   ocupados, el que llega entra en ESA sesión y quedan 19. Por eso el RPC
--   busca primero una sesión viva y solo si no hay ninguna recurre al comodín.
--   Crear una sesión paralela habría permitido meter 20 personas más en un
--   laboratorio que ya estaba lleno.
--
-- ATOMICIDAD
--   `refresh_session_count` (0001) ya bloquea la sesión con `for update` al
--   insertar. Este RPC toma **el mismo bloqueo antes de contar**, así que dos
--   laboratoristas registrando a la vez no pueden pasarse del aforo: el segundo
--   espera al primero y ve el conteo actualizado.
--
-- IDEMPOTENTE: `add column if not exists`, `create index if not exists` y
-- `create or replace function`. Se puede reejecutar sin efectos.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Columnas nuevas
-- ----------------------------------------------------------------------------

-- Cuántas personas caben en el laboratorio para práctica espontánea, cuando no
-- hay ninguna sesión programada que fije el límite. Se arranca en 20 —el mismo
-- criterio del piloto— y cada laboratorista lo ajusta a su realidad:
--     update public.laboratories set walk_in_capacity = 12 where code = 'CIM';
alter table public.laboratories
  add column if not exists walk_in_capacity integer not null default 20
    check (walk_in_capacity > 0);

-- Marca el bloque comodín. Es distinto de `is_active`: el comodín existe pero
-- NO se ofrece en el calendario.
alter table public.schedule_blocks
  add column if not exists is_walk_in boolean not null default false;

-- Momento real de ingreso. En una reserva programada la hora de inicio ya dice
-- cuándo debía entrar la persona; en un walk-in no hay horario, así que la hora
-- de llegada es el único dato temporal que significa algo.
--
-- Queda NULL en las asistencias marcadas por el escáner o a mano: esas
-- funciones no se tocan en esta migración para no alterar lo que ya opera.
-- Poblarlas ahí es una mejora posterior, no un requisito de esta.
alter table public.reservations
  add column if not exists checked_in_at timestamptz;

-- Un solo bloque comodín por laboratorio.
create unique index if not exists uq_walk_in_block_por_lab
  on public.schedule_blocks (lab_id)
  where is_walk_in;

comment on column public.laboratories.walk_in_capacity is
  'Aforo para entrada inmediata cuando no hay sesión programada en curso.';
comment on column public.schedule_blocks.is_walk_in is
  'Bloque comodín que agrupa las entradas inmediatas. Nunca se ofrece en el calendario.';
comment on column public.reservations.checked_in_at is
  'Momento de ingreso efectivo. Lo llena el walk-in; NULL en asistencia programada.';


-- ----------------------------------------------------------------------------
-- 2) Autocompletado: ¿conocemos ya a este estudiante?
-- ----------------------------------------------------------------------------
-- Evita que el laboratorista teclee nombre y correo de alguien que ya vino
-- antes, y —más importante— evita que los escriba distinto y ensucie la
-- identidad canónica.
--
-- SECURITY DEFINER con verificación explícita de rol: `students` no es legible
-- por `authenticated` bajo RLS, y aun así esto no puede convertirse en un
-- directorio consultable por cualquiera con sesión.
create or replace function public.lookup_student_by_code(p_student_code text)
returns table (
  student_id   uuid,
  student_code text,
  full_name    text,
  email        text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := regexp_replace(coalesce(p_student_code, ''), '\D', '', 'g');
begin
  -- Solo personal. Un estudiante con sesión no puede usarlo para buscar a otros.
  if not (public.is_jefe() or exists (
            select 1 from public.lab_admins la where la.admin_id = auth.uid()))
  then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if length(v_code) = 0 then
    return;
  end if;

  return query
    select s.id, s.student_code, s.full_name, s.email
      from public.students s
     where s.student_code = v_code;
end;
$$;

revoke all on function public.lookup_student_by_code(text) from public;
grant execute on function public.lookup_student_by_code(text) to authenticated;


-- ----------------------------------------------------------------------------
-- 3) El RPC de entrada inmediata
-- ----------------------------------------------------------------------------
-- `p_consent_version` va al final y con valor por defecto: así la firma que se
-- especificó sigue siendo invocable tal cual, pero no perdemos el rastro de
-- habeas data. Un walk-in también trata datos personales (nombre, correo,
-- código), y la Ley 1581 no distingue si la reserva se hizo por internet o de
-- pie frente al laboratorista.
drop function if exists public.register_walk_in_attendance(text, text, text, text, uuid, uuid);
drop function if exists public.register_walk_in_attendance(text, text, text, text, uuid, uuid, text);

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
  c_inicio_jornada constant time := '06:00';
  c_fin_jornada    constant time := '22:00';

  v_lab        uuid;
  v_aforo_lab  integer;
  v_ahora      timestamp := (now() at time zone 'America/Bogota');
  v_hoy        date;
  v_hora       time;
  v_code       text;
  v_nombre     text;
  v_correo     text;
  v_ses        uuid;
  v_comodin    boolean := false;
  v_blk        uuid;
  v_cap        integer;
  v_puestos_max integer;
  v_personas   integer;
  v_puestos    integer;
  v_est        uuid;
  v_res        uuid;
  v_previa     uuid;
  v_ini        time;
  v_fin        time;
begin
  v_hoy  := v_ahora::date;
  v_hora := v_ahora::time;

  -- --- Laboratorio y autorización ------------------------------------------
  select l.id, l.walk_in_capacity into v_lab, v_aforo_lab
    from public.laboratories l
   where l.code = p_lab_code and l.is_active;

  if v_lab is null then
    raise exception 'Laboratorio % no encontrado o inactivo', p_lab_code;
  end if;

  if not (public.is_lab_admin(v_lab) or public.is_jefe()) then
    raise exception 'No autorizado: no administras este laboratorio'
      using errcode = '42501';
  end if;

  -- --- Datos del estudiante -------------------------------------------------
  -- El código se normaliza a dígitos por el mismo motivo que en el escáner:
  -- Code 39 puede traer los delimitadores '*' y algunos lectores meten espacios.
  v_code   := regexp_replace(coalesce(p_student_code, ''), '\D', '', 'g');
  v_nombre := nullif(btrim(coalesce(p_student_name, '')), '');
  v_correo := lower(nullif(btrim(coalesce(p_student_email, '')), ''));

  if length(v_code) = 0 then
    raise exception 'Falta el código del estudiante';
  end if;

  -- --- Sesión en curso, si la hay ------------------------------------------
  -- `for update` aquí es lo que hace atómico el control de aforo: a partir de
  -- este punto ningún otro laboratorista puede contar sobre la misma sesión
  -- hasta que esta transacción termine.
  select bs.id, bs.capacity, bs.workstations, bs.start_time, bs.end_time
    into v_ses, v_cap, v_puestos_max, v_ini, v_fin
    from public.block_sessions bs
   where bs.lab_id = v_lab
     and bs.session_date = v_hoy
     and bs.status = 'abierta'::session_status
     and v_hora >= bs.start_time
     and v_hora <  bs.end_time
   order by bs.start_time
   limit 1
   for update;

  -- --- Si no hay ninguna, el comodín ---------------------------------------
  if v_ses is null then
    v_comodin := true;

    -- El bloque comodín: uno por laboratorio, `is_active = false` para que
    -- `ensure_sessions` no lo materialice nunca y `lab_sessions_public` no lo
    -- ofrezca jamás en el calendario del estudiante.
    --
    -- `weekday` no significa nada aquí: se fija en 1 porque la columna es NOT
    -- NULL con check 1..7. El bloque no representa un día, representa "todo lo
    -- que llegó sin cita".
    select b.id into v_blk
      from public.schedule_blocks b
     where b.lab_id = v_lab and b.is_walk_in;

    if v_blk is null then
      insert into public.schedule_blocks
        (lab_id, weekday, start_time, end_time, capacity, is_active, is_walk_in)
      values
        (v_lab, 1, c_inicio_jornada, c_fin_jornada, v_aforo_lab, false, true)
      returning id into v_blk;
    end if;

    -- Una sesión comodín por día. El unique (block_id, session_date) hace que
    -- dos registros simultáneos no puedan duplicarla.
    insert into public.block_sessions
      (block_id, lab_id, session_date, start_time, end_time, capacity, status)
    values
      (v_blk, v_lab, v_hoy, c_inicio_jornada, c_fin_jornada, v_aforo_lab, 'abierta')
    on conflict (block_id, session_date) do nothing;

    select bs.id, bs.capacity, bs.workstations, bs.start_time, bs.end_time
      into v_ses, v_cap, v_puestos_max, v_ini, v_fin
      from public.block_sessions bs
     where bs.block_id = v_blk and bs.session_date = v_hoy
     for update;
  end if;

  -- --- ¿Ya estaba registrado en esta sesión? --------------------------------
  -- Caso real: el estudiante sí había reservado y el laboratorista usa el
  -- walk-in por costumbre. Sería absurdo devolverle un error: lo correcto es
  -- marcarle la asistencia sobre su reserva y avisar que ya la tenía.
  select r.id into v_previa
    from public.reservations r
   where r.session_id = v_ses
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

    select o.personas into v_personas from public.session_occupancy(v_ses) o;

    return query
      select v_previa, v_ses, r.student_ref, v_comodin, true,
             greatest(v_cap - v_personas, 0), v_ini, v_fin
        from public.reservations r where r.id = v_previa;
    return;
  end if;

  -- --- Control de aforo -----------------------------------------------------
  select o.personas, o.puestos into v_personas, v_puestos
    from public.session_occupancy(v_ses) o;

  if v_personas >= v_cap then
    raise exception
      'Aforo lleno: % de % ocupados en % (%–%). No se puede registrar la entrada.',
      v_personas, v_cap, p_lab_code, v_ini::text, v_fin::text
      using errcode = 'P0001';
  end if;

  -- Un walk-in siempre es individual (group_id null), así que ocupa un puesto.
  if v_puestos_max is not null and v_puestos >= v_puestos_max then
    raise exception
      'Sin puestos de trabajo: % de % ocupados en %.',
      v_puestos, v_puestos_max, p_lab_code
      using errcode = 'P0001';
  end if;

  -- --- Identidad canónica ---------------------------------------------------
  -- upsert_student exige nombre y correo. Si el laboratorista no los escribió y
  -- el estudiante no existía, no se inventa nada: se pide el dato.
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

  -- --- La reserva, ya aprobada y con asistencia -----------------------------
  insert into public.reservations (
    session_id, student_id, student_ref,
    student_name, student_email, student_code,
    subject_id, program_id,
    status, attended, checked_in_at,
    decided_by, decided_at,
    consent_version, consent_accepted_at, consent_self
  ) values (
    v_ses, null, v_est,
    v_nombre, v_correo, v_code,
    p_subject_id, p_program_id,
    'aprobada'::reservation_status, true, now(),
    auth.uid(), now(),
    p_consent_version,
    case when p_consent_version is not null then now() end,
    -- false: la autorización no la dio el titular en un formulario, la recogió
    -- el laboratorista en persona. Queda distinguible en la auditoría.
    case when p_consent_version is not null then false end
  )
  returning id into v_res;

  -- El trigger ya recalculó reserved_count; se relee para informar cupos.
  select o.personas into v_personas from public.session_occupancy(v_ses) o;

  return query
    select v_res, v_ses, v_est, v_comodin, false,
           greatest(v_cap - v_personas, 0), v_ini, v_fin;
end;
$$;

revoke all on function public.register_walk_in_attendance(text, text, text, text, uuid, uuid, text) from public;
grant execute on function public.register_walk_in_attendance(text, text, text, text, uuid, uuid, text)
  to authenticated;


-- ============================================================================
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- No basta con que la migración corra: `create or replace function` valida la
-- sintaxis, no que las referencias existan. Esto comprueba que los objetos
-- quedaron instalados y con permisos.
--
-- Para probarlo de verdad, con sesión de laboratorista del lab en cuestión:
--   select * from public.register_walk_in_attendance(
--     'CIM', '1234567', 'Nombre Apellido', 'correo@unimilitar.edu.co', null, null, '1.1');
-- ============================================================================
select 'columna laboratories.walk_in_capacity' as objeto,
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='laboratories'
                            and column_name='walk_in_capacity')
            then 'OK' else '*** FALTA ***' end as estado
union all
select 'columna schedule_blocks.is_walk_in',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='schedule_blocks'
                            and column_name='is_walk_in')
            then 'OK' else '*** FALTA ***' end
union all
select 'columna reservations.checked_in_at',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='reservations'
                            and column_name='checked_in_at')
            then 'OK' else '*** FALTA ***' end
union all
select 'funcion register_walk_in_attendance',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='register_walk_in_attendance')
            then 'OK' else '*** FALTA ***' end
union all
select 'funcion lookup_student_by_code',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='lookup_student_by_code')
            then 'OK' else '*** FALTA ***' end
union all
select 'GRANT a authenticated',
       case when has_function_privilege('authenticated',
              'public.register_walk_in_attendance(text,text,text,text,uuid,uuid,text)', 'execute')
            then 'OK' else '*** FALTA ***' end
order by 1;
