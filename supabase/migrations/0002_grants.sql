-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios
-- Migración 0002: GRANTs de tabla faltantes para el rol `authenticated`
-- ----------------------------------------------------------------------------
-- 0001_init.sql habilitó RLS y definió las policies, pero solo otorgó
-- GRANT EXECUTE sobre las 4 RPCs de negocio. Nunca se otorgaron privilegios de
-- tabla a `authenticated`, así que cualquier SELECT/INSERT/UPDATE/DELETE directo
-- (p.ej. leer el propio perfil desde el proxy) falla con "permission denied"
-- (42501) antes de que Postgres llegue a evaluar las policies de RLS.
--
-- RLS ya filtra qué filas puede tocar cada quien; estos GRANT solo habilitan el
-- intento a nivel de tabla, según lo que cada policy ya contempla.
-- ============================================================================

-- profiles: cada quien lee/edita lo suyo (o el Jefe, todo). El INSERT lo hace
-- el trigger on_auth_user_created (SECURITY DEFINER), no requiere grant aquí.
grant select, update on public.profiles to authenticated;

-- laboratories: lectura general; alta/edición/baja reservada al Jefe o al
-- laboratorista dueño del lab (ya filtrado por labs_insert/labs_update/labs_delete).
grant select, insert, update, delete on public.laboratories to authenticated;

-- lab_admins: el Jefe gestiona asignaciones laboratorista↔lab.
grant select, insert, update, delete on public.lab_admins to authenticated;

-- schedule_blocks: lectura general (ver bloques); escritura del dueño del lab o Jefe.
grant select, insert, update, delete on public.schedule_blocks to authenticated;

-- block_sessions: lectura general (ver disponibilidad); escritura del dueño del
-- lab o Jefe. ensure_sessions() ya inserta vía SECURITY DEFINER sin depender de esto.
grant select, insert, update, delete on public.block_sessions to authenticated;

-- reservations: SOLO lectura directa (propia / lab_admin / Jefe). Las mutaciones
-- siguen sin policy a propósito — únicamente ocurren vía las RPCs SECURITY DEFINER
-- (request_reservation, cancel_reservation, decide_reservation).
grant select on public.reservations to authenticated;

-- Vistas del dashboard del Jefe (security_invoker: corren con RLS de quien consulta).
grant select on public.v_lab_usage        to authenticated;
grant select on public.v_demanda_horaria  to authenticated;
grant select on public.v_ocupacion_sesion to authenticated;
