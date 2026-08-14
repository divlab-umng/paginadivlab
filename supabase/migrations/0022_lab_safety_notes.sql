-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0022_lab_safety_notes.sql — instrucciones de ingreso por laboratorio
-- ----------------------------------------------------------------------------
-- POR QUÉ
--   El correo de aprobación traía instrucciones genéricas iguales para todos los
--   laboratorios. Pero entrar a Metales no es lo mismo que entrar a CIM: uno
--   exige gafas de seguridad y no llevar anillos ni manga suelta cerca de las
--   máquinas; el otro, no tocar las celdas en movimiento. Un texto genérico
--   termina siendo ignorado justo porque no dice nada concreto.
--
--   Quien sabe qué advertir es el laboratorista, no quien programa. Por eso el
--   texto vive en la base y se edita desde /panel/horarios.
--
-- COMPORTAMIENTO
--   NULL o vacío → el correo usa las instrucciones genéricas de siempre.
--   Con texto     → el correo usa las del laboratorio, una viñeta por línea.
--
-- ⚠️ Este texto lo escribe una persona y termina dentro de un correo HTML.
--    La aplicación lo ESCAPA antes de insertarlo (ver `escapar` en
--    lib/email/templates.ts): sin eso, un `<` o un `&` romperían la maqueta del
--    mensaje. No quitar ese escapado.
--
-- Idempotente.
-- ============================================================================

set search_path = public;

alter table public.laboratories
  add column if not exists safety_notes text;

comment on column public.laboratories.safety_notes is
  'Instrucciones de ingreso propias del laboratorio, una por línea. NULL = usar las genéricas del correo.';

-- ---------------------------------------------------------------------------
-- Edición: solo el laboratorista asignado a ese lab, o el jefe.
-- ---------------------------------------------------------------------------
create or replace function public.set_lab_safety_notes(
  p_lab_id uuid,
  p_notes  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not (public.is_lab_admin(p_lab_id) or public.is_jefe()) then
    raise exception 'No administras este laboratorio';
  end if;

  -- Tope defensivo: es un correo, no un manual. Si necesitan más, va en el PDF
  -- de requisitos del laboratorio.
  if v_notes is not null and length(v_notes) > 2000 then
    raise exception 'Las instrucciones no pueden superar 2000 caracteres';
  end if;

  update public.laboratories
     set safety_notes = v_notes
   where id = p_lab_id;

  if not found then
    raise exception 'Laboratorio no encontrado';
  end if;
end;
$$;

grant execute on function public.set_lab_safety_notes(uuid, text) to authenticated;

-- ============================================================================
-- VERIFICACIÓN
--   select code, safety_notes from public.laboratories
--    where code in ('METALES','CIM','DISENO_SIMULACION_EXP');
-- ============================================================================
