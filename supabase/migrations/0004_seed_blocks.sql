-- ============================================================================
-- UMNG · paginadivlab — 0004_seed_blocks.sql
-- Bloques horarios de PRUEBA para 3 laboratorios
-- ----------------------------------------------------------------------------
-- Siembra public.schedule_blocks para METALES, ROBOTICA y AUTOMATIZACION_CONTROL
-- para poder construir y ver la vista del estudiante con datos reales.
-- (La creación de bloques desde el panel del laboratorista queda como feature aparte.)
--
-- Idempotente: on conflict (lab_id, weekday, start_time) do nothing.
-- Resuelve lab_id por 'code' con un JOIN → no hay que pegar UUIDs a mano.
--
-- weekday ISO: 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb, 7=Dom.
-- capacity = aforo máximo del bloque.
-- valid_from / valid_until quedan NULL (siempre vigente). En producción se fijan
-- al periodo académico.
--
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

insert into public.schedule_blocks (lab_id, weekday, start_time, end_time, capacity)
select l.id, v.weekday, v.start_time, v.end_time, v.capacity
from public.laboratories l
join (values
  -- LABORATORIO METALES
  ('METALES',                1, time '08:00', time '10:00', 12),
  ('METALES',                1, time '10:00', time '12:00', 12),
  ('METALES',                3, time '14:00', time '16:00', 12),
  ('METALES',                5, time '08:00', time '10:00', 15),
  -- LABORATORIO ROBÓTICA
  ('ROBOTICA',               2, time '08:00', time '10:00', 10),
  ('ROBOTICA',               2, time '10:00', time '12:00', 10),
  ('ROBOTICA',               4, time '14:00', time '16:00', 10),
  -- LABORATORIO AUTOMATIZACIÓN Y CONTROL
  ('AUTOMATIZACION_CONTROL', 1, time '14:00', time '16:00', 15),
  ('AUTOMATIZACION_CONTROL', 3, time '08:00', time '10:00', 15),
  ('AUTOMATIZACION_CONTROL', 3, time '10:00', time '12:00', 15),
  ('AUTOMATIZACION_CONTROL', 5, time '14:00', time '17:00', 20)
) as v(code, weekday, start_time, end_time, capacity)
  on v.code = l.code
on conflict (lab_id, weekday, start_time) do nothing;

-- Verificación: lista los bloques sembrados en formato legible (debe traer 11 filas).
select l.code,
       case b.weekday
         when 1 then 'Lun' when 2 then 'Mar' when 3 then 'Mié'
         when 4 then 'Jue' when 5 then 'Vie' when 6 then 'Sáb' when 7 then 'Dom'
       end                       as dia,
       to_char(b.start_time, 'HH24:MI') as inicio,
       to_char(b.end_time,   'HH24:MI') as fin,
       b.capacity                as aforo
from public.schedule_blocks b
join public.laboratories l on l.id = b.lab_id
order by l.code, b.weekday, b.start_time;
