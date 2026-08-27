-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0028_walk_in_franjas.sql — CORRIGE LAS HORAS DEL COMODÍN
-- ----------------------------------------------------------------------------
-- CORRIGE UN FALLO DE LAS MIGRACIONES 0026/0027.
--
-- SÍNTOMA
--   Toda entrada inmediata sumaba 16 horas de práctica.
--
-- LA CAUSA
--   Las horas no salen de la persona sino de la SESIÓN:
--
--       round(extract(epoch from (bs.end_time - bs.start_time)) / 3600.0, 2)
--
--   Esa expresión está en `v_student_lab_hours`, en `v_reservas_detalle`, en el
--   dashboard y en el Excel. Como el comodín abarcaba 06:00–22:00, cualquiera
--   que entrara diez minutos quedaba con 16 horas acreditadas.
--
--   Un segundo efecto, menos visible pero igual de grave: con UNA sesión de
--   toda la jornada y aforo 20, solo cabían 20 entradas inmediatas en el día
--   entero. A media mañana el laboratorio quedaba "lleno" hasta el otro día.
--
-- LA CORRECCIÓN
--   El comodín deja de ser una bolsa de 16 horas y pasa a franjas de duración
--   configurable (2 h por defecto), alineadas desde medianoche. Quien llega a
--   las 11:30 entra en la de 10:00–12:00.
--
--   Eso arregla las dos cosas a la vez: las horas acreditadas son las de una
--   práctica real, y el aforo se renueva en cada franja en vez de agotarse.
--
--   Se ancla en medianoche y no en la hora de apertura porque así la franja
--   SIEMPRE contiene el momento actual, sin casos raros a las 5 a. m. ni al
--   cierre. Con 120 minutos las franjas caen en horas redondas (1440 es
--   divisible por 120), que es como las lee un humano.
--
-- POR QUÉ NO SE USA LA DURACIÓN REAL DE LA VISITA
--   Sería lo ideal, pero el sistema registra la entrada (`checked_in_at`) y no
--   la salida: nadie marca cuando se va. Acreditar la franja es la mejor
--   aproximación disponible y es exactamente el mismo criterio que ya se aplica
--   a las prácticas programadas — a nadie se le descuenta por irse temprano.
--
-- IDEMPOTENTE.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Duración configurable por laboratorio
-- ----------------------------------------------------------------------------
-- Mismo criterio que `walk_in_capacity`: un valor de arranque razonable que el
-- laboratorista ajusta sin tocar código.
--     update public.laboratories set walk_in_duracion_min = 60 where code = 'CIM';
alter table public.laboratories
  add column if not exists walk_in_duracion_min integer not null default 120
    check (walk_in_duracion_min > 0 and 1440 % walk_in_duracion_min = 0);

comment on column public.laboratories.walk_in_duracion_min is
  'Duración en minutos de cada franja de práctica libre. Debe dividir a 1440 para que las franjas cierren el día exacto.';


-- ----------------------------------------------------------------------------
-- 2) Un bloque comodín por FRANJA, no uno por laboratorio
-- ----------------------------------------------------------------------------
-- El índice de 0026 permitía un solo comodín por laboratorio, lo que obligaba a
-- que cubriera toda la jornada. Ahora hace falta uno por franja.
drop index if exists public.uq_walk_in_block_por_lab;

create unique index if not exists uq_walk_in_block_franja
  on public.schedule_blocks (lab_id, start_time)
  where is_walk_in;


-- ----------------------------------------------------------------------------
-- 3) `walk_in_session` calcula la franja que contiene el momento actual
-- ----------------------------------------------------------------------------
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
  v_ahora timestamp := (now() at time zone 'America/Bogota');
  v_hoy   date;
  v_hora  time;
  v_aforo integer;
  v_dur   integer;
  v_ini   time;
  v_fin   time;
  v_blk   uuid;
begin
  v_hoy  := v_ahora::date;
  v_hora := v_ahora::time;

  select l.walk_in_capacity, l.walk_in_duracion_min
    into v_aforo, v_dur
    from public.laboratories l where l.id = p_lab_id;

  -- Sesión programada en curso: tiene prioridad. El aforo de un laboratorio no
  -- es abstracto, es el de la práctica que está ocurriendo. Quien llega a las
  -- 11:30 con una clase de 11:00–12:00 entra en ESA, no en una paralela.
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

  -- Franja de práctica libre que contiene este momento. `div` sobre los minutos
  -- transcurridos desde medianoche da el índice de la franja.
  v_ini := make_time(
             ((extract(hour from v_hora)::int * 60 + extract(minute from v_hora)::int)
                / v_dur * v_dur) / 60,
             ((extract(hour from v_hora)::int * 60 + extract(minute from v_hora)::int)
                / v_dur * v_dur) % 60,
             0);
  v_fin := v_ini + make_interval(mins => v_dur);

  select b.id into v_blk
    from public.schedule_blocks b
   where b.lab_id = p_lab_id and b.is_walk_in and b.start_time = v_ini;

  if v_blk is null then
    -- `is_active = false` para que `ensure_sessions` no lo materialice y
    -- `lab_sessions_public` no lo ofrezca nunca en el calendario. `weekday` se
    -- fija en 1 porque la columna es NOT NULL con check 1..7: aquí no
    -- representa un día de la semana.
    insert into public.schedule_blocks
      (lab_id, weekday, start_time, end_time, capacity, is_active, is_walk_in)
    values
      (p_lab_id, 1, v_ini, v_fin, v_aforo, false, true)
    on conflict do nothing
    returning id into v_blk;

    if v_blk is null then
      select b.id into v_blk
        from public.schedule_blocks b
       where b.lab_id = p_lab_id and b.is_walk_in and b.start_time = v_ini;
    end if;
  end if;

  insert into public.block_sessions
    (block_id, lab_id, session_date, start_time, end_time, capacity, status)
  values
    (v_blk, p_lab_id, v_hoy, v_ini, v_fin, v_aforo, 'abierta')
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
-- 4) Reparar las sesiones comodín que ya existen
-- ----------------------------------------------------------------------------
-- Las creadas por 0026/0027 abarcan 06:00–22:00 y están acreditando 16 horas.
-- Se estrechan a la franja que contiene la PRIMERA entrada registrada en ellas
-- (`checked_in_at`), que es el dato más cercano a la realidad disponible.
--
-- Es una aproximación y solo aplica a las pocas filas del piloto: si en una
-- misma sesión hubo entradas de la mañana y de la tarde, todas quedan
-- acreditadas con la franja de la primera. A partir de esta migración el
-- problema no se repite porque cada franja es su propia sesión.
with primeras as (
  select bs.id,
         coalesce(
           min(r.checked_in_at at time zone 'America/Bogota')::time,
           '08:00'::time
         ) as ref,
         l.walk_in_duracion_min as dur
    from public.block_sessions bs
    join public.schedule_blocks b on b.id = bs.block_id and b.is_walk_in
    join public.laboratories    l on l.id = bs.lab_id
    left join public.reservations r on r.session_id = bs.id
   where bs.start_time = '06:00' and bs.end_time = '22:00'
   group by bs.id, l.walk_in_duracion_min
)
update public.block_sessions bs
   set start_time = make_time(
         ((extract(hour from p.ref)::int * 60 + extract(minute from p.ref)::int)
            / p.dur * p.dur) / 60,
         ((extract(hour from p.ref)::int * 60 + extract(minute from p.ref)::int)
            / p.dur * p.dur) % 60, 0),
       end_time = make_time(
         ((extract(hour from p.ref)::int * 60 + extract(minute from p.ref)::int)
            / p.dur * p.dur) / 60,
         ((extract(hour from p.ref)::int * 60 + extract(minute from p.ref)::int)
            / p.dur * p.dur) % 60, 0) + make_interval(mins => p.dur)
  from primeras p
 where bs.id = p.id;

-- Y sus bloques, para que coincidan con la sesión que contienen.
update public.schedule_blocks b
   set start_time = bs.start_time,
       end_time   = bs.end_time
  from public.block_sessions bs
 where bs.block_id = b.id
   and b.is_walk_in
   and b.start_time = '06:00' and b.end_time = '22:00';


-- ============================================================================
-- VERIFICACIÓN — ninguna práctica libre debe pasar de unas pocas horas
-- ============================================================================
select l.code                                as laboratorio,
       bs.session_date,
       bs.start_time,
       bs.end_time,
       round(extract(epoch from (bs.end_time - bs.start_time)) / 3600.0, 2) as horas_acreditadas,
       count(r.id)                           as personas
  from public.block_sessions bs
  join public.schedule_blocks b on b.id = bs.block_id and b.is_walk_in
  join public.laboratories    l on l.id = bs.lab_id
  left join public.reservations r on r.session_id = bs.id
 group by l.code, bs.session_date, bs.start_time, bs.end_time
 order by bs.session_date desc, bs.start_time;
