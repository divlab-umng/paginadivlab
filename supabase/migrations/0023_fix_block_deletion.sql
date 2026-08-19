-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0023_fix_block_deletion.sql
-- ----------------------------------------------------------------------------
-- CORRIGE: al eliminar una franja desde /panel/horarios, seguía apareciendo en
-- el calendario del estudiante.
--
-- LA CAUSA
--   El horario vive en DOS tablas. `schedule_blocks` guarda la regla ("CIM,
--   jueves, 11:00–12:00") y `block_sessions` guarda las fechas concretas que esa
--   regla genera, hasta 8 semanas por delante.
--
--   `deactivate_schedule_block` marcaba `schedule_blocks.is_active = false`, y
--   `ensure_sessions` sí respeta esa bandera: dejaba de generar sesiones nuevas.
--   Pero `lab_sessions_public` —la consulta que alimenta el calendario— leía
--   `block_sessions` DIRECTAMENTE, sin unirse nunca a `schedule_blocks`:
--
--       from public.block_sessions bs
--       where bs.lab_id = v_lab_id and bs.session_date between ...
--
--   Las sesiones materializadas ANTES del borrado seguían ahí, en estado
--   'abierta', y el calendario las mostraba. Se borraba el padre pero los hijos
--   ya habían nacido.
--
-- LA CORRECCIÓN, EN DOS FRENTES
--   1) `lab_sessions_public` se une a `schedule_blocks` y exige `is_active`.
--      Es la defensa de fondo: aunque queden sesiones huérfanas por cualquier
--      otra vía, el calendario ya no las muestra. Y es reversible — si el
--      laboratorista reactiva el bloque, sus sesiones vuelven a verse.
--
--   2) `deactivate_schedule_block` ahora LIMPIA las sesiones futuras vacías, en
--      vez de dejar basura acumulándose. Y sobre todo: SE NIEGA A BORRAR si la
--      franja tiene reservas futuras pendientes o aprobadas.
--
-- POR QUÉ NEGARSE EN VEZ DE CANCELAR EN CASCADA
--   Un estudiante con reserva aprobada YA RECIBIÓ un correo diciéndole a qué
--   hora presentarse. Si el borrado cancelara en silencio, esa persona llegaría
--   al laboratorio a una práctica que no existe y nadie se habría enterado.
--   Negarse obliga a resolverlo de frente: el laboratorista rechaza esas
--   solicitudes una por una —lo que sí manda correo con motivo— y después borra
--   la franja. El sistema no toma por su cuenta una decisión que afecta a
--   personas que ya fueron notificadas.
--
-- SEGURIDAD: no borra reservas, no borra sesiones ocupadas y no toca datos
-- históricos. Las sesiones pasadas se conservan intactas para las métricas.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) El calendario deja de mostrar sesiones de bloques desactivados
-- ----------------------------------------------------------------------------
-- Se reescribe completa (no se puede alterar solo el cuerpo). Es idéntica a la
-- versión de 0016 salvo el join a schedule_blocks y el filtro `b.is_active`.
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
      -- ↓ LA CORRECCIÓN. Sin este join, una franja eliminada seguía ofreciendo
      --   sus sesiones ya generadas.
      join public.schedule_blocks b on b.id = bs.block_id
      -- Puestos ocupados por grupo. Va después del join normal porque un
      -- LATERAL puede referenciar todo lo que tenga a su izquierda, y así queda
      -- a la vista de dónde sale el `bs.id` que recibe.
      cross join lateral public.session_occupancy(bs.id) o
     where bs.lab_id = v_lab_id
       and b.is_active
       and bs.session_date between v_from and v_to
     order by bs.session_date, bs.start_time;
end;
$$;

revoke all on function public.lab_sessions_public(text, date, date) from public;
grant execute on function public.lab_sessions_public(text, date, date)
  to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2) Eliminar una franja: se niega si hay gente, y limpia si no la hay
-- ----------------------------------------------------------------------------
create or replace function public.deactivate_schedule_block(p_block_id uuid)
returns public.schedule_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block     public.schedule_blocks;
  v_ocupadas  integer;
  v_borradas  integer;
begin
  select * into v_block from public.schedule_blocks where id = p_block_id;
  if not found then
    raise exception 'Bloque no encontrado';
  end if;

  if not (public.is_lab_admin(v_block.lab_id) or public.is_jefe()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- ¿Hay estudiantes comprometidos con esta franja de hoy en adelante?
  -- Solo cuentan 'pendiente' y 'aprobada': una reserva rechazada o cancelada ya
  -- no espera nada de nadie.
  select count(*) into v_ocupadas
    from public.reservations r
    join public.block_sessions bs on bs.id = r.session_id
   where bs.block_id = p_block_id
     and bs.session_date >= current_date
     and r.status in ('pendiente', 'aprobada');

  if v_ocupadas > 0 then
    raise exception
      'No se puede eliminar: esta franja tiene % reserva(s) pendiente(s) o aprobada(s) a futuro. Recházalas primero desde la bandeja del panel (así el estudiante recibe el aviso por correo) y vuelve a intentarlo.',
      v_ocupadas
      using errcode = 'P0001';
  end if;

  -- Sin nadie afectado: se borran las sesiones futuras para que el calendario
  -- quede limpio de inmediato. Las pasadas se conservan: son el histórico del
  -- que salen las métricas y el Excel del jefe.
  delete from public.block_sessions
   where block_id = p_block_id
     and session_date >= current_date;
  get diagnostics v_borradas = row_count;

  update public.schedule_blocks
     set is_active = false
   where id = p_block_id
   returning * into v_block;

  raise notice 'Franja desactivada. Sesiones futuras eliminadas: %', v_borradas;
  return v_block;
end;
$$;

revoke all on function public.deactivate_schedule_block(uuid) from public;
grant execute on function public.deactivate_schedule_block(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 3) Limpieza de la basura que dejó el fallo
-- ----------------------------------------------------------------------------
-- Sesiones futuras y vacías que quedaron colgando de bloques ya desactivados,
-- de las veces que se eliminó una franja antes de esta corrección. Se borran
-- solo si NADIE las reservó; si alguna tiene reservas, se deja quieta y se
-- reporta abajo para revisarla a mano.
delete from public.block_sessions bs
 using public.schedule_blocks b
 where b.id = bs.block_id
   and not b.is_active
   and bs.session_date >= current_date
   and not exists (
     select 1 from public.reservations r
      where r.session_id = bs.id
        and r.status in ('pendiente', 'aprobada')
   );

-- ============================================================================
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- ⚠️ NO BASTA CON QUE LA MIGRACIÓN SE APLIQUE SIN ERROR.
--    `create or replace function` solo comprueba la SINTAXIS: no valida que las
--    tablas y los alias que usa el cuerpo existan de verdad. Una función puede
--    instalarse sin una queja y reventar al primer llamado. Y ni el build de
--    Next.js ni el typecheck miran dentro de una función de Postgres.
--
--    Por eso esta verificación INVOCA la función en vez de mirar el catálogo.
--    Debe devolver filas con fechas y horas. Si devuelve un error, algo quedó
--    mal y hay que corregirlo ANTES de que un estudiante abra el calendario.
-- ============================================================================
select session_date, start_time, end_time,
       capacity, reserved, disponibles, puestos_usados, reservable
  from public.lab_sessions_public('MATERIALES', current_date, current_date + 7)
 order by session_date, start_time
 limit 10;


-- Segunda comprobación: debe salir VACÍO. Si aparece algo, son franjas ya
-- eliminadas que todavía tienen estudiantes esperando; hay que resolverlas una
-- por una antes de darlas por cerradas.
select l.code                as laboratorio,
       bs.session_date,
       bs.start_time,
       count(r.id)           as reservas_vivas
  from public.block_sessions bs
  join public.schedule_blocks b on b.id = bs.block_id
  join public.laboratories   l  on l.id = bs.lab_id
  join public.reservations   r  on r.session_id = bs.id
 where not b.is_active
   and bs.session_date >= current_date
   and r.status in ('pendiente', 'aprobada')
 group by l.code, bs.session_date, bs.start_time
 order by bs.session_date, bs.start_time;
