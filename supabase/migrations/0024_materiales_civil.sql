-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0024_materiales_civil.sql — LABORATORIO DE MATERIALES
-- ----------------------------------------------------------------------------
-- Incorpora el Laboratorio de Materiales al piloto:
--
--   · Carrera nueva: Ingeniería Civil (hasta ahora solo había Mecatrónica,
--     Industrial, Biomédica y Multimedia).
--   · Materias: Mecánica de sólidos, Teoría de esfuerzos, Mecánica de suelos,
--     Tecnología de concreto y Laboratorio pavimentos para Civil; Materiales
--     de ingeniería para Industrial.
--   · Horario abierto de práctica libre: lunes a viernes, 8:00–17:00.
--
-- SOBRE EL "HORARIO ABIERTO"
--   El estudiante no reserva "una hora cualquiera": reserva una SESIÓN concreta
--   que nace de un bloque publicado. No existe un modo "sin horario". Lo que se
--   hace aquí es sembrar la jornada completa en bloques, de modo que en la
--   práctica el laboratorio quede abierto de par en par.
--
--   El laboratorista conserva el control: desde /panel/horarios puede eliminar
--   los bloques que no apliquen, cambiarles el aforo o agregar otros. Esta
--   migración define el punto de partida, no una camisa de fuerza.
--
-- LA MALLA: 8:00–17:00 EN BLOQUES DE 2 HORAS
--   08:00–10:00 · 10:00–12:00 · 12:00–14:00 · 14:00–16:00 · 16:00–17:00
--
--   Nueve horas no se dividen en bloques exactos de dos, así que el último
--   tramo queda de una hora para no dejar las 16:00–17:00 sin cubrir. Si se
--   prefiere cerrar a las 16:00, basta eliminar ese bloque desde el panel.
--
-- AFORO 20 Y SIN LÍMITE DE PUESTOS
--   Mismo criterio que el resto del piloto: es un valor de arranque razonable
--   que el laboratorista ajusta a la realidad de su laboratorio sin tocar SQL.
--
-- IDEMPOTENTE: se puede ejecutar varias veces sin duplicar nada.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Carrera nueva
-- ----------------------------------------------------------------------------
insert into public.programs (code, name) values
  ('CIVIL', 'Ingeniería Civil')
on conflict (code) do update set name = excluded.name, is_active = true;


-- ----------------------------------------------------------------------------
-- 2) Materias
-- ----------------------------------------------------------------------------
insert into public.subjects (code, name) values
  ('MECANICA_SOLIDOS',     'Mecánica de sólidos'),
  ('TEORIA_ESFUERZOS',     'Teoría de esfuerzos'),
  ('MECANICA_SUELOS',      'Mecánica de suelos'),
  ('TECNOLOGIA_CONCRETO',  'Tecnología de concreto'),
  ('LAB_PAVIMENTOS',       'Laboratorio pavimentos'),
  ('MATERIALES_INGENIERIA','Materiales de ingeniería')
on conflict (code) do update set name = excluded.name, is_active = true;


-- ----------------------------------------------------------------------------
-- 3) Materia → laboratorio (las seis van a MATERIALES)
-- ----------------------------------------------------------------------------
insert into public.subject_labs (subject_id, lab_id)
select s.id, l.id
  from (values
    ('MECANICA_SOLIDOS',      'MATERIALES'),
    ('TEORIA_ESFUERZOS',      'MATERIALES'),
    ('MECANICA_SUELOS',       'MATERIALES'),
    ('TECNOLOGIA_CONCRETO',   'MATERIALES'),
    ('LAB_PAVIMENTOS',        'MATERIALES'),
    ('MATERIALES_INGENIERIA', 'MATERIALES')
  ) as v(materia, lab)
  join public.subjects     s on s.code = v.materia
  join public.laboratories l on l.code = v.lab
on conflict (subject_id, lab_id) do nothing;


-- ----------------------------------------------------------------------------
-- 4) Materia → carrera
-- ----------------------------------------------------------------------------
-- Las cinco de estructuras y suelos son exclusivas de Civil; Materiales de
-- ingeniería es la que cursa Industrial. Un estudiante de Industrial que elija
-- su carrera no verá las materias de Civil, y viceversa.
insert into public.subject_programs (subject_id, program_id)
select s.id, p.id
  from (values
    ('MECANICA_SOLIDOS',      'CIVIL'),
    ('TEORIA_ESFUERZOS',      'CIVIL'),
    ('MECANICA_SUELOS',       'CIVIL'),
    ('TECNOLOGIA_CONCRETO',   'CIVIL'),
    ('LAB_PAVIMENTOS',        'CIVIL'),
    ('MATERIALES_INGENIERIA', 'INDUSTRIAL')
  ) as v(materia, carrera)
  join public.subjects s on s.code = v.materia
  join public.programs p on p.code = v.carrera
on conflict (subject_id, program_id) do nothing;


-- ----------------------------------------------------------------------------
-- 5) El laboratorio queda activo
-- ----------------------------------------------------------------------------
-- lab_sessions_public exige `laboratories.is_active`; si MATERIALES estuviera
-- inactivo en el catálogo, el calendario lanzaría "Laboratorio no encontrado".
update public.laboratories
   set is_active = true
 where code = 'MATERIALES';


-- ----------------------------------------------------------------------------
-- 6) Horario abierto: lunes a viernes, 8:00–17:00
-- ----------------------------------------------------------------------------
do $$
declare
  v_lab   uuid;
  v_desde date := current_date;
  v_hasta date := current_date + 56;   -- 8 semanas, la ventana que genera la app
begin
  select id into v_lab from public.laboratories where code = 'MATERIALES';
  if v_lab is null then
    raise exception 'No existe el laboratorio MATERIALES en el catálogo (¿falta la migración 0003?)';
  end if;

  -- weekday usa isodow: 1 = lunes … 5 = viernes.
  insert into public.schedule_blocks
    (lab_id, weekday, start_time, end_time, capacity, workstations, is_active)
  select v_lab, d.dia::smallint, h.inicio, h.fin, 20, null::integer, true
    from generate_series(1, 5) as d(dia)
    cross join (values
      ('08:00'::time, '10:00'::time),
      ('10:00'::time, '12:00'::time),
      ('12:00'::time, '14:00'::time),
      ('14:00'::time, '16:00'::time),
      ('16:00'::time, '17:00'::time)
    ) as h(inicio, fin)
  on conflict (lab_id, weekday, start_time) do update
     set end_time    = excluded.end_time,
         capacity    = excluded.capacity,
         is_active   = true;

  -- Materializa las sesiones de las próximas 8 semanas. La app también las crea
  -- sola al abrir el calendario, pero adelantarlo hace que el laboratorista vea
  -- el horario completo desde el primer momento, sin que nadie tenga que entrar
  -- primero a "despertarlo".
  perform public.ensure_sessions(v_lab, v_desde, v_hasta);
end $$;


-- ============================================================================
-- VERIFICACIÓN — debería mostrar 25 bloques (5 días × 5 franjas)
-- ============================================================================
select 'bloques activos en MATERIALES' as dato, count(*)::text as valor
  from public.schedule_blocks b
  join public.laboratories l on l.id = b.lab_id
 where l.code = 'MATERIALES' and b.is_active
union all
select 'sesiones generadas', count(*)::text
  from public.block_sessions bs
  join public.laboratories l on l.id = bs.lab_id
 where l.code = 'MATERIALES' and bs.session_date >= current_date
union all
select 'materias de MATERIALES', count(*)::text
  from public.subject_labs sl
  join public.laboratories l on l.id = sl.lab_id
 where l.code = 'MATERIALES'
union all
select 'materias de Ingeniería Civil', count(*)::text
  from public.subject_programs sp
  join public.programs p on p.id = sp.program_id
 where p.code = 'CIVIL';
