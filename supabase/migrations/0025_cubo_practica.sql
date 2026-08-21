-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0025_cubo_practica.sql — LABORATORIO CUBO DE PRÁCTICA
-- ----------------------------------------------------------------------------
-- Incorpora la oferta académica del Cubo de Práctica:
--
--   Ingeniería Civil      → Hidráulica I, Hidráulica II,
--                           Mecánica de Fluidos y Tuberías
--   Ingeniería Ambiental  → Mecánica de Fluidos
--
-- NO CREA EL LABORATORIO: ya existe desde 0003_seed_labs.sql como
-- 'CUBO_PRACTICA' / 'LABORATORIO CUBO DE PRÁCTICA'. Aquí solo se referencia.
--
-- CARRERA NUEVA
--   Ingeniería Ambiental no estaba: hasta ahora había Mecatrónica, Industrial,
--   Biomédica y Multimedia (0020) más Civil (0024).
--
-- DOS MATERIAS DISTINTAS, NO UNA
--   'Mecánica de Fluidos' (Ambiental) y 'Mecánica de Fluidos y Tuberías'
--   (Civil) llegaron con nombres diferentes, así que se registran por separado.
--   Si en la práctica resultan ser la misma asignatura, lo correcto es
--   unificarlas en una sola fila de `subjects` y colgarla de las DOS carreras
--   en `subject_programs` — para eso está el N:M. Mientras tanto se respeta lo
--   que dice el plan de estudios.
--
-- POR QUÉ ES UNA MIGRACIÓN NUEVA Y NO UNA EDICIÓN DE 0020
--   0020 documenta la configuración con la que arrancó el piloto en agosto de
--   2026. Meterle hoy un laboratorio que no estaba haría que ese archivo
--   afirmara algo falso sobre su propio momento, y se perdería el rastro de
--   cuándo entró cada laboratorio.
--
-- IDEMPOTENTE: se puede ejecutar las veces que haga falta sin duplicar nada.
-- Todos los insert llevan `on conflict`, amparados en los índices únicos que
-- ya define el esquema:
--     programs.code            unique
--     subjects.code            unique
--     subject_labs      unique (subject_id, lab_id)
--     subject_programs  unique (subject_id, program_id)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Carrera nueva
-- ----------------------------------------------------------------------------
insert into public.programs (code, name) values
  ('AMBIENTAL', 'Ingeniería Ambiental')
on conflict (code) do update set name = excluded.name, is_active = true;


-- ----------------------------------------------------------------------------
-- 2) Materias
-- ----------------------------------------------------------------------------
insert into public.subjects (code, name) values
  ('HIDRAULICA_I',              'Hidráulica I'),
  ('HIDRAULICA_II',             'Hidráulica II'),
  ('MECANICA_FLUIDOS_TUBERIAS', 'Mecánica de Fluidos y Tuberías'),
  ('MECANICA_FLUIDOS',          'Mecánica de Fluidos')
on conflict (code) do update set name = excluded.name, is_active = true;


-- ----------------------------------------------------------------------------
-- 3) Materia → laboratorio
-- ----------------------------------------------------------------------------
-- El join contra `laboratories` por `code` es lo que garantiza la integridad
-- referencial: si el laboratorio no existiera, la fila simplemente no se
-- insertaría en vez de reventar contra la clave foránea. El bloque de
-- verificación del final detecta ese caso.
insert into public.subject_labs (subject_id, lab_id)
select s.id, l.id
  from (values
    ('HIDRAULICA_I',              'CUBO_PRACTICA'),
    ('HIDRAULICA_II',             'CUBO_PRACTICA'),
    ('MECANICA_FLUIDOS_TUBERIAS', 'CUBO_PRACTICA'),
    ('MECANICA_FLUIDOS',          'CUBO_PRACTICA')
  ) as v(materia, lab)
  join public.subjects     s on s.code = v.materia
  join public.laboratories l on l.code = v.lab
on conflict (subject_id, lab_id) do nothing;


-- ----------------------------------------------------------------------------
-- 4) Materia → carrera
-- ----------------------------------------------------------------------------
-- Aquí es donde el N:M hace su trabajo: las dos carreras comparten el mismo
-- laboratorio, pero un estudiante de Ambiental solo verá Mecánica de Fluidos, y
-- uno de Civil solo las tres suyas.
insert into public.subject_programs (subject_id, program_id)
select s.id, p.id
  from (values
    ('HIDRAULICA_I',              'CIVIL'),
    ('HIDRAULICA_II',             'CIVIL'),
    ('MECANICA_FLUIDOS_TUBERIAS', 'CIVIL'),
    ('MECANICA_FLUIDOS',          'AMBIENTAL')
  ) as v(materia, carrera)
  join public.subjects s on s.code = v.materia
  join public.programs p on p.code = v.carrera
on conflict (subject_id, program_id) do nothing;


-- ----------------------------------------------------------------------------
-- 5) El laboratorio queda activo
-- ----------------------------------------------------------------------------
-- `lab_sessions_public` exige `laboratories.is_active`; si el Cubo estuviera
-- inactivo en el catálogo, el calendario lanzaría "Laboratorio no encontrado".
update public.laboratories
   set is_active = true
 where code = 'CUBO_PRACTICA';


-- ============================================================================
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- Valores esperados: 4 materias en el Cubo, 3 de Civil en el Cubo,
-- 1 de Ambiental, y el laboratorio activo.
--
-- ⚠️ LA ÚLTIMA FILA ES LA QUE IMPORTA. Esta migración da de alta la OFERTA
--    ACADÉMICA, no el horario. Si "bloques horarios publicados" sale en 0, el
--    estudiante podrá elegir Ambiental o Civil y llegar hasta el Cubo, pero
--    encontrará el CALENDARIO VACÍO: no hay franjas que reservar.
--
--    Eso se resuelve sin SQL: el laboratorista del Cubo entra a
--    /panel/horarios y publica sus bloques. Requiere que el jefe le haya
--    asignado ese laboratorio desde Personal. Si nadie lo tiene asignado,
--    tampoco le llegarán los correos de solicitud.
-- ============================================================================
select 'materias del Cubo (esperado 4)' as comprobacion, count(*)::text as valor
  from public.subject_labs sl
  join public.laboratories l on l.id = sl.lab_id
 where l.code = 'CUBO_PRACTICA'
union all
select 'materias de Ingeniería Civil (3 nuevas + 5 de Materiales)', count(*)::text
  from public.subject_programs sp
  join public.programs p on p.id = sp.program_id
 where p.code = 'CIVIL'
union all
select 'materias de Ingeniería Ambiental (esperado 1)', count(*)::text
  from public.subject_programs sp
  join public.programs p on p.id = sp.program_id
 where p.code = 'AMBIENTAL'
union all
select 'laboratorio activo (esperado true)', is_active::text
  from public.laboratories
 where code = 'CUBO_PRACTICA'
union all
select 'bloques horarios publicados', count(*)::text
  from public.schedule_blocks b
  join public.laboratories l on l.id = b.lab_id
 where l.code = 'CUBO_PRACTICA' and b.is_active
union all
select 'laboratorista asignado', coalesce(string_agg(pr.email, ', '), '--- NADIE ---')
  from public.lab_admins la
  join public.laboratories l  on l.id = la.lab_id
  join public.profiles     pr on pr.id = la.admin_id
 where l.code = 'CUBO_PRACTICA';
