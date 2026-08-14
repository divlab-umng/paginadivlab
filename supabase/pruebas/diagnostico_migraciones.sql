-- ============================================================================
-- DIAGNÓSTICO — ¿qué migraciones están realmente aplicadas?
-- ----------------------------------------------------------------------------
-- NO es una migración. Pégalo completo en el SQL Editor de Supabase y dale Run.
--
-- POR QUÉ HACE FALTA
--   Las migraciones se aplican a mano, pegándolas en el SQL Editor. Es fácil
--   saltarse una, aplicarlas fuera de orden o creer que se aplicó una que en
--   realidad falló a la mitad. El síntoma llega mucho después y es confuso: la
--   aplicación compila, despliega en verde y revienta al usarla con un error de
--   columna inexistente que no menciona la migración culpable.
--
--   No consulta un registro de migraciones —no existe— sino que le pregunta al
--   esquema si cada objeto que la migración debía crear está ahí. Es la única
--   fuente de verdad.
--
-- CÓMO LEERLO
--   Toda fila debe decir OK. Si alguna dice FALTA, aplica esa migración y las
--   anteriores que también falten, en orden numérico.
--
--   Solo mira el catálogo del sistema, así que es seguro aunque falten tablas:
--   nunca falla, solo reporta.
-- ============================================================================

with marcadores (orden, migracion, tipo, objeto) as (
  values
    -- 0016 · grupos de trabajo y puestos
    (16, '0016 grupos de trabajo',   'col', 'reservations.group_id'),
    (16, '0016 grupos de trabajo',   'col', 'reservations.is_group_leader'),
    (16, '0016 grupos de trabajo',   'col', 'laboratories.max_group_size'),
    (16, '0016 grupos de trabajo',   'col', 'schedule_blocks.workstations'),
    (16, '0016 grupos de trabajo',   'fn',  'session_occupancy'),
    (16, '0016 grupos de trabajo',   'fn',  'cancel_group_reservation_public'),

    -- 0017 · gestión de personal
    (17, '0017 gestion personal',    'col', 'profiles.staff_requested_at'),
    (17, '0017 gestion personal',    'fn',  'list_staff'),
    (17, '0017 gestion personal',    'fn',  'set_user_role'),
    (17, '0017 gestion personal',    'fn',  'set_lab_admins'),

    -- 0018 · consentimiento de datos
    (18, '0018 consentimiento',      'col', 'reservations.consent_version'),
    (18, '0018 consentimiento',      'col', 'reservations.consent_accepted_at'),
    (18, '0018 consentimiento',      'col', 'reservations.consent_self'),

    -- 0019 · carreras y cascada
    (19, '0019 carreras',            'tb',  'programs'),
    (19, '0019 carreras',            'tb',  'subject_programs'),
    (19, '0019 carreras',            'col', 'reservations.program_id'),

    -- 0021 · destinatarios de notificación
    (21, '0021 destinatarios',       'fn',  'reservation_notification_targets'),

    -- 0022 · instrucciones de ingreso por laboratorio
    (22, '0022 instrucciones',       'col', 'laboratories.safety_notes'),
    (22, '0022 instrucciones',       'fn',  'set_lab_safety_notes')
),

revision as (
  select
    m.orden,
    m.migracion,
    m.objeto,
    case m.tipo
      when 'col' then exists (
        select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name   = split_part(m.objeto, '.', 1)
           and c.column_name  = split_part(m.objeto, '.', 2))
      when 'fn' then exists (
        select 1 from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = m.objeto)
      when 'tb' then to_regclass('public.' || m.objeto) is not null
    end as presente
  from marcadores m
),

-- El conteo de las filas que sembró 0020 va aparte, al final del archivo. No se
-- puede unir aquí: un count(*) sobre una tabla inexistente rompe la consulta
-- entera en tiempo de planificación, y entonces el diagnóstico fallaría justo
-- cuando más falta hace. Esta parte solo lee el catálogo y nunca falla.
select migracion, objeto,
       case when presente then 'OK' else '*** FALTA ***' end as estado
  from revision
 order by orden, objeto;


-- ============================================================================
-- SEGUNDA CONSULTA — ¿hay datos del piloto?
-- ----------------------------------------------------------------------------
-- Ejecútala SOLO si arriba todo dijo OK (necesita que las tablas existan).
--
-- CÓMO CORRERLA SOLA: selecciona con el mouse desde el `select` de abajo hasta
-- el `order by 1;` final y dale Run. Supabase ejecuta únicamente lo resaltado.
-- Si corres el archivo completo, el editor muestra solo este último resultado.
--
-- VALORES ESPERADOS TRAS LA 0020 (agosto 2026)
--   carreras 4 · materias 9 · materia-lab 9 · materia-carrera 14
--   bloques activos 5 (Metales jue+vie, CIM jue+vie, Diseño vie)
--   sesiones generadas 40 = 5 bloques × 8 semanas
--
--   `sesiones generadas` en 0 es la señal de alarma: el calendario se vería
--   vacío aunque los bloques existan, porque el estudiante reserva sesiones
--   concretas, no bloques.
-- ============================================================================

select 'carreras (programs)'                  as dato, count(*) as filas from public.programs
union all select 'materias (subjects)',                count(*) from public.subjects
union all select 'materia-carrera (subject_programs)', count(*) from public.subject_programs
union all select 'materia-lab (subject_labs)',         count(*) from public.subject_labs
union all select 'laboratorios',                       count(*) from public.laboratories
union all select 'bloques horarios activos',           count(*) from public.schedule_blocks where is_active
union all select 'sesiones generadas',                 count(*) from public.block_sessions
order by 1;
