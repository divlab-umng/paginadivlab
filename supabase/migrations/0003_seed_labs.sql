-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0003_seed_labs.sql — Carga inicial de laboratorios
-- ----------------------------------------------------------------------------
-- Siembra public.laboratories con los espacios físicos oficiales.
--
-- Idempotente: re-ejecutarla NO duplica (on conflict (code) do nothing).
-- Ejecutar en el SQL Editor de Supabase: corre como superusuario y omite RLS.
-- (Desde la app, la policy labs_insert exige is_jefe() — un estudiante o
--  laboratorista no puede insertar labs. Por eso el seed va por el SQL Editor.)
--
-- Columnas pobladas:
--   code → slug único, MAYÚSCULAS sin tildes, sin el prefijo 'LABORATORIO'.
--   name → nombre oficial completo, tal como lo entrega la institución.
-- location y description quedan NULL a propósito: se completan luego con el
-- campus / edificio / salón real de cada laboratorio.
-- ============================================================================

insert into public.laboratories (code, name) values
  ('VIDRIERIA',              'BODEGA DE VIDRIERÍA'),
  ('INVERNADEROS',           'INVERNADEROS'),
  ('PREHOSPITALARIA',        'LABORATORIO ATENCIÓN PREHOSPITALARIA'),
  ('AUTOMATIZACION_CONTROL', 'LABORATORIO AUTOMATIZACIÓN Y CONTROL'),
  ('BIODIVERSIDAD',          'LABORATORIO BIODIVERSIDAD'),
  ('BIOLOGIA_PROFUNDIZACION','LABORATORIO BIOLOGÍA PROFUNDIZACIÓN'),
  ('BIOMECATRONICA_F2',      'LABORATORIO BIOMECATRÓNICA FASE 2'),
  ('BIOQUIMICA',             'LABORATORIO BIOQUÍMICA'),
  ('BIORGANICA',             'LABORATORIO BIORGÁNICA'),
  ('BIOTECNOLOGIA_VEGETAL',  'LABORATORIO BIOTECNOLOGÍA VEGETAL'),
  ('CENTRO_CONTROL_F2',      'LABORATORIO CENTRO DE CONTROL FASE 2'),
  ('CIM',                    'LABORATORIO CIM (Células Integradas de Manufactura)'),
  ('CONTROL_BIOLOGICO',      'LABORATORIO CONTROL BIOLÓGICO'),
  ('CUBO_PRACTICA',          'LABORATORIO CUBO DE PRÁCTICA'),
  ('CULTIVO_TEJIDOS',        'LABORATORIO CULTIVO DE TEJIDOS'),
  ('DISENO_SIMULACION_EXP',  'LABORATORIO DISEÑO Y SIMULACIÓN DE EXPERIMENTOS'),
  ('ECOLOGIA',               'LABORATORIO ECOLOGÍA'),
  ('ELECTRONICA',            'LABORATORIO ELECTRÓNICA'),
  ('EMBRIOLOGIA',            'LABORATORIO EMBRIOLOGÍA'),
  ('ENERGIAS_RENOVABLES',    'LABORATORIO ENERGIAS RENOVABLES'),
  ('ENTOMOLOGIA',            'LABORATORIO ENTOMOLOGÍA'),
  ('ERGONOMIA',              'LABORATORIO ERGONOMÍA'),
  ('FISICA_CABAL',           'LABORATORIO FÍSICA CABAL'),
  ('FISICA_F1',              'LABORATORIO FÍSICA FASE 1'),
  ('FISICA_PROF_F2',         'LABORATORIO FÍSICA PROFUNDIZACIÓN FASE 2'),
  ('FISIOLOGIA_ANIMAL',      'LABORATORIO FISIOLOGÍA ANIMAL'),
  ('FITOPATOLOGIA',          'LABORATORIO FITOPATOLOGÍA'),
  ('FOTOGRAMETRIA',          'LABORATORIO FOTOGRAMETRÍA'),
  ('HIDROBIOLOGIA',          'LABORATORIO HIDROBIOLOGÍA'),
  ('HIPERMEDIA',             'LABORATORIO HIPERMEDIA'),
  ('HORTICULTURA',           'LABORATORIO HORTICULTURA'),
  ('HSE',                    'LABORATORIO HSE'),
  ('LOGISTICA',              'LABORATORIO LOGÍSTICA'),
  ('MATERIALES',             'LABORATORIO MATERIALES'),
  ('METALES',                'LABORATORIO METALES'),
  ('METROLOGIA',             'LABORATORIO METROLOGÍA'),
  ('MICROSCOPIA',            'LABORATORIO MICROSCOPIA'),
  ('MOCAP',                  'LABORATORIO MOCAP (Movimiento y Captura)'),
  ('MULTIPLE_1',             'LABORATORIO MÚLTIPLE 1'),
  ('MULTIPLE_2',             'LABORATORIO MÚLTIPLE 2'),
  ('QUIMICA_F1',             'LABORATORIO QUÍMICA FASE 1'),
  ('QUIMICA_ORGANICA_CABAL', 'LABORATORIO QUÍMICA ORGÁNICA CABAL'),
  ('QUIMICA_PROF_F2',        'LABORATORIO QUÍMICA PROFUNDIZACIÓN FASE 2'),
  ('RAAS',                   'LABORATORIO RAAS (Recursos Aire, Agua y Suelo)'),
  ('ROBOTICA',               'LABORATORIO ROBÓTICA'),
  ('SALA_ESTERILIZACION',    'LABORATORIO SALA ESTERILIZACIÓN'),
  ('SIMULACION_F2',          'LABORATORIO SIMULACIÓN FASE 2'),
  ('TOPOGRAFIA',             'LABORATORIO TOPOGRAFÍA'),
  ('TOXICOLOGIA',            'LABORATORIO TOXICOLOGÍA'),
  ('SALA_LAVADO',            'SALA DE LAVADO')
on conflict (code) do nothing;

-- Verificación rápida: debe devolver 50.
select count(*) as total_labs, count(*) filter (where is_active) as activos
from public.laboratories;
