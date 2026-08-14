-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0020_seed_piloto.sql — DATOS DEL PILOTO
-- ----------------------------------------------------------------------------
-- Carga carreras, materias, su mapeo y los horarios de práctica libre de los
-- tres laboratorios con los que arranca el piloto.
--
-- CONFIGURACIÓN ENTREGADA POR LA DIVISIÓN (agosto 2026)
--
--   METALES · jueves y viernes, 11:00–12:00
--     Carreras: Mecatrónica, Industrial, Biomédica
--     Materias: Procesos de Mecanizado, Tecnología Mecánica, Tecnología II
--
--   CIM · jueves y viernes, 11:00–12:00
--     Carreras: Mecatrónica, Industrial, Biomédica
--     Materias: Automatización
--
--   DISEÑO, EXPERIMENTACIÓN Y SIMULACIÓN · viernes, 14:00–16:00
--     Carrera: Multimedia (exclusivo)
--     Materias: Render, Audio y Video, Animación 3D y Dinámicas,
--               Programación III, Modelado 3D
--
-- BIOMÉDICA COMPARTE MATERIAS
--   Biomédica está autorizada en Metales y CIM pero no aporta materias propias:
--   por decisión de la División, ve las mismas materias de esos laboratorios.
--   Ese es exactamente el caso que justifica el N:M entre materia y carrera.
--
-- AFORO Y PUESTOS: PROVISIONALES
--   Se siembran con aforo 20 y sin límite de puestos. Cada laboratorista los
--   ajusta a su realidad desde /panel/horarios sin tocar la base de datos.
--
-- Idempotente: se puede re-ejecutar sin duplicar.
-- ============================================================================

set search_path = public;

-- ============================================================================
-- 1. LIMPIEZA de datos de prueba que estorban al piloto
-- ----------------------------------------------------------------------------
-- Los bloques de 0004 eran semillas de prueba con horarios inventados. Si se
-- dejan, el estudiante vería franjas que no existen en la realidad.
-- Al borrar el bloque se van en cascada sus sesiones y las reservas de prueba.
-- ============================================================================
delete from public.schedule_blocks
 where lab_id in (
   select id from public.laboratories
    where code in ('AUTOMATIZACION_CONTROL', 'METALES', 'ROBOTICA', 'CIM',
                   'DISENO_SIMULACION_EXP')
 );

-- Automatización y Control sale del piloto: se quita su mapeo de materia.
delete from public.subject_labs sl
 using public.laboratories l
 where l.id = sl.lab_id and l.code = 'AUTOMATIZACION_CONTROL';

-- Configuración de grupos de las pruebas anteriores.
update public.laboratories
   set max_group_size = null
 where code in ('AUTOMATIZACION_CONTROL', 'CIM');

-- ============================================================================
-- 2. CARRERAS
-- ============================================================================
insert into public.programs (code, name) values
  ('MECATRONICA', 'Ingeniería Mecatrónica'),
  ('INDUSTRIAL',  'Ingeniería Industrial'),
  ('BIOMEDICA',   'Ingeniería Biomédica'),
  ('MULTIMEDIA',  'Ingeniería Multimedia')
on conflict (code) do update set name = excluded.name;

-- ============================================================================
-- 3. MATERIAS
-- ============================================================================
insert into public.subjects (code, name) values
  ('PROCESOS_MECANIZADO', 'Procesos de Mecanizado'),
  ('TECNOLOGIA_MECANICA', 'Tecnología Mecánica'),
  ('TECNOLOGIA_II',       'Tecnología II'),
  ('AUTOMATIZACION',      'Automatización'),
  ('RENDER',              'Render'),
  ('AUDIO_VIDEO',         'Audio y Video'),
  ('ANIMACION_3D',        'Animación 3D y Dinámicas'),
  ('PROGRAMACION_III',    'Programación III'),
  ('MODELADO_3D',         'Modelado 3D')
on conflict (code) do update set name = excluded.name, is_active = true;

-- La materia de prueba que ya no aplica al piloto.
update public.subjects set is_active = false
 where code not in ('PROCESOS_MECANIZADO','TECNOLOGIA_MECANICA','TECNOLOGIA_II',
                    'AUTOMATIZACION','RENDER','AUDIO_VIDEO','ANIMACION_3D',
                    'PROGRAMACION_III','MODELADO_3D');

-- ============================================================================
-- 4. MATERIA → CARRERA
-- ----------------------------------------------------------------------------
-- Biomédica comparte las materias de Metales y CIM.
-- Las de Multimedia son exclusivas de esa carrera.
-- ============================================================================
insert into public.subject_programs (subject_id, program_id)
select s.id, p.id
  from (values
    ('PROCESOS_MECANIZADO', 'MECATRONICA'),
    ('PROCESOS_MECANIZADO', 'BIOMEDICA'),
    ('TECNOLOGIA_MECANICA', 'MECATRONICA'),
    ('TECNOLOGIA_MECANICA', 'BIOMEDICA'),
    ('TECNOLOGIA_II',       'INDUSTRIAL'),
    ('TECNOLOGIA_II',       'BIOMEDICA'),
    ('AUTOMATIZACION',      'MECATRONICA'),
    ('AUTOMATIZACION',      'INDUSTRIAL'),
    ('AUTOMATIZACION',      'BIOMEDICA'),
    ('RENDER',              'MULTIMEDIA'),
    ('AUDIO_VIDEO',         'MULTIMEDIA'),
    ('ANIMACION_3D',        'MULTIMEDIA'),
    ('PROGRAMACION_III',    'MULTIMEDIA'),
    ('MODELADO_3D',         'MULTIMEDIA')
  ) as v(materia, carrera)
  join public.subjects s on s.code = v.materia
  join public.programs p on p.code = v.carrera
on conflict (subject_id, program_id) do nothing;

-- ============================================================================
-- 5. MATERIA → LABORATORIO
-- ============================================================================
insert into public.subject_labs (subject_id, lab_id)
select s.id, l.id
  from (values
    ('PROCESOS_MECANIZADO', 'METALES'),
    ('TECNOLOGIA_MECANICA', 'METALES'),
    ('TECNOLOGIA_II',       'METALES'),
    ('AUTOMATIZACION',      'CIM'),
    ('RENDER',              'DISENO_SIMULACION_EXP'),
    ('AUDIO_VIDEO',         'DISENO_SIMULACION_EXP'),
    ('ANIMACION_3D',        'DISENO_SIMULACION_EXP'),
    ('PROGRAMACION_III',    'DISENO_SIMULACION_EXP'),
    ('MODELADO_3D',         'DISENO_SIMULACION_EXP')
  ) as v(materia, lab)
  join public.subjects     s on s.code = v.materia
  join public.laboratories l on l.code = v.lab
on conflict (subject_id, lab_id) do nothing;

-- ============================================================================
-- 6. HORARIOS DE PRÁCTICA LIBRE
-- ----------------------------------------------------------------------------
-- weekday en ISO: 1=Lunes … 4=Jueves, 5=Viernes.
-- capacity 20 y workstations NULL son PROVISIONALES: el laboratorista los ajusta
-- desde /panel/horarios.
-- ============================================================================
insert into public.schedule_blocks (lab_id, weekday, start_time, end_time, capacity, workstations)
select l.id, v.weekday, v.inicio::time, v.fin::time, v.aforo, null
  from (values
    ('METALES',               4, '11:00', '12:00', 20),
    ('METALES',               5, '11:00', '12:00', 20),
    ('CIM',                   4, '11:00', '12:00', 20),
    ('CIM',                   5, '11:00', '12:00', 20),
    ('DISENO_SIMULACION_EXP', 5, '14:00', '16:00', 20)
  ) as v(lab, weekday, inicio, fin, aforo)
  join public.laboratories l on l.code = v.lab
on conflict (lab_id, weekday, start_time) do nothing;

-- ============================================================================
-- 7. Materializar las sesiones de las próximas 8 semanas
-- ============================================================================
do $$
declare r record;
begin
  for r in select id from public.laboratories
            where code in ('METALES', 'CIM', 'DISENO_SIMULACION_EXP')
  loop
    perform public.ensure_sessions(r.id, current_date, current_date + 56);
  end loop;
end $$;

-- ============================================================================
-- VERIFICACIÓN — la cascada completa, tal como la verá el estudiante
-- ============================================================================
select p.name as carrera,
       s.name as materia,
       l.code as laboratorio,
       string_agg(distinct
         case sb.weekday when 1 then 'Lun' when 2 then 'Mar' when 3 then 'Mié'
                         when 4 then 'Jue' when 5 then 'Vie' when 6 then 'Sáb' end
         || ' ' || to_char(sb.start_time,'HH24:MI') || '-' || to_char(sb.end_time,'HH24:MI'),
         ' · ') as horarios
  from public.subject_programs sp
  join public.programs      p  on p.id  = sp.program_id
  join public.subjects      s  on s.id  = sp.subject_id and s.is_active
  join public.subject_labs  sl on sl.subject_id = s.id
  join public.laboratories  l  on l.id  = sl.lab_id
  left join public.schedule_blocks sb on sb.lab_id = l.id and sb.is_active
 group by p.name, s.name, l.code
 order by p.name, s.name;
