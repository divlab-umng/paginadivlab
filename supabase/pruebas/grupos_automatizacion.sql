-- ============================================================================
-- PRUEBAS — Configurar AUTOMATIZACIÓN Y CONTROL para probar grupos de trabajo
-- ----------------------------------------------------------------------------
-- NO es una migración. No lo pongas en supabase/migrations/.
--
-- Deja el laboratorio con una configuración pensada para que la restricción de
-- PUESTOS se note enseguida:
--     aforo 15 (el que ya tienen los bloques)  ·  2 puestos  ·  grupos de 4
--
-- Con eso, DOS grupos de 4 (8 personas) agotan los puestos aunque queden
-- 7 cupos de aforo libres. Es justo el caso que el sistema no podía ver antes.
--
-- ⚠️ OJO CON LA COPIA DENORMALIZADA
--    block_sessions guarda su propio `workstations` (igual que `capacity`),
--    porque la validación ocurre sobre la fila que se bloquea con FOR UPDATE.
--    Actualizar solo schedule_blocks NO afecta a las sesiones ya materializadas.
--    Por eso el paso 3 es obligatorio.
-- ============================================================================

-- ── 1) Política de grupos del laboratorio ───────────────────────────────────
update public.laboratories
   set max_group_size = 4
 where code = 'AUTOMATIZACION_CONTROL';

-- ── 2) Puestos de trabajo en todos sus bloques ──────────────────────────────
update public.schedule_blocks
   set workstations = 2
 where lab_id = (select id from public.laboratories where code = 'AUTOMATIZACION_CONTROL');

-- ── 3) Propagar a las sesiones YA materializadas (el paso que se olvida) ────
update public.block_sessions bs
   set workstations = sb.workstations
  from public.schedule_blocks sb
 where sb.id = bs.block_id
   and bs.lab_id = (select id from public.laboratories where code = 'AUTOMATIZACION_CONTROL');


-- ============================================================================
-- VERIFICACIÓN — cómo va la ocupación, con los DOS contadores
-- ----------------------------------------------------------------------------
-- Ejecútala antes y después de cada reserva de prueba. Fíjate en que
-- `personas` sube de 4 en 4 mientras `puestos` sube de 1 en 1.
-- ============================================================================
select bs.session_date,
       bs.start_time,
       bs.capacity                       as aforo,
       o.personas,
       bs.workstations                   as puestos_totales,
       o.puestos                         as puestos_usados,
       (bs.capacity - o.personas)        as cupos_libres,
       (bs.workstations - o.puestos)     as puestos_libres
  from public.block_sessions bs
  cross join lateral public.session_occupancy(bs.id) o
 where bs.lab_id = (select id from public.laboratories where code = 'AUTOMATIZACION_CONTROL')
   and bs.session_date >= current_date
 order by bs.session_date, bs.start_time
 limit 15;


-- ============================================================================
-- ¿QUIÉN ESTÁ EN CADA GRUPO?
-- ============================================================================
select bs.session_date,
       bs.start_time,
       coalesce(left(r.group_id::text, 8), 'individual') as grupo,
       r.is_group_leader                                 as creo_el_grupo,
       r.student_code,
       r.student_name,
       r.status
  from public.reservations r
  join public.block_sessions bs on bs.id = r.session_id
 where bs.lab_id = (select id from public.laboratories where code = 'AUTOMATIZACION_CONTROL')
   and bs.session_date >= current_date
 order by bs.session_date, bs.start_time, r.group_id nulls last, r.is_group_leader desc;


-- ============================================================================
-- REINICIAR LA PRUEBA — borra las reservas de este lab a futuro
-- ----------------------------------------------------------------------------
-- Útil para repetir el ejercicio desde cero sin tocar el histórico.
-- ============================================================================
-- delete from public.reservations r
--  using public.block_sessions bs
--  where bs.id = r.session_id
--    and bs.session_date >= current_date
--    and bs.lab_id = (select id from public.laboratories where code = 'AUTOMATIZACION_CONTROL');


-- ============================================================================
-- DEJARLO COMO ESTABA — quitar la configuración de grupos y puestos
-- ============================================================================
-- update public.laboratories   set max_group_size = null where code = 'AUTOMATIZACION_CONTROL';
-- update public.schedule_blocks set workstations  = null
--  where lab_id = (select id from public.laboratories where code = 'AUTOMATIZACION_CONTROL');
-- update public.block_sessions  set workstations  = null
--  where lab_id = (select id from public.laboratories where code = 'AUTOMATIZACION_CONTROL');
