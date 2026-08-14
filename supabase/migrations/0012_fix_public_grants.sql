-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0012_fix_public_grants.sql — GRANTs faltantes para `authenticated`
-- ----------------------------------------------------------------------------
-- SÍNTOMA
--   En /reservar: "No pudimos cargar las materias — permission denied for
--   table subjects" (error 42501), pero SOLO cuando el visitante tiene sesión
--   iniciada. En incógnito (sin sesión) la página cargaba bien.
--
-- CAUSA
--   La 0009 otorgó SELECT sobre subjects y subject_labs únicamente al rol
--   `anon`. Supabase usa DOS roles distintos según haya o no sesión:
--       sin sesión  → anon
--       con sesión  → authenticated
--   Un laboratorista, el jefe, o cualquiera con sesión abierta llega como
--   `authenticated` y choca contra la falta de privilegio de tabla ANTES de que
--   Postgres evalúe las policies de RLS.
--
--   Es exactamente el mismo error que corrigió la 0002 con `profiles`. Regla
--   para no repetirlo: toda tabla que el flujo público lea debe otorgarse a
--   AMBOS roles (`anon, authenticated`); RLS es quien decide qué filas ve cada uno.
--
-- Idempotente: los GRANT se pueden re-ejecutar sin efecto adverso.
-- ============================================================================

set search_path = public;

-- Catálogo de materias y su mapeo a laboratorios: lectura para ambos roles.
-- La policy subjects_select ya limita a las materias activas (o todo, si es jefe).
grant select on public.subjects     to anon, authenticated;
grant select on public.subject_labs to anon, authenticated;

-- ============================================================================
-- Verificación: las 5 filas deben salir todas en 'OK'.
-- Si alguna dice 'FALTA', ese rol no podrá leer la tabla desde la app.
-- ============================================================================
select t.tabla,
       case when has_table_privilege('anon', t.tabla, 'SELECT')          then 'OK' else 'FALTA' end as anon,
       case when has_table_privilege('authenticated', t.tabla, 'SELECT') then 'OK' else 'FALTA' end as authenticated
from (values
  ('public.subjects'),
  ('public.subject_labs'),
  ('public.laboratories'),
  ('public.block_sessions'),
  ('public.schedule_blocks')
) as t(tabla);
