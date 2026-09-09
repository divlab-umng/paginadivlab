-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0030_seed_cuatro_labs.sql
-- ----------------------------------------------------------------------------
-- Incorpora cuatro laboratorios con su oferta académica completa:
--
--   Robótica · Centro de Control · Electrónica · Biomecatrónica
--
-- CARRERAS NUEVAS
--   ARISST (Administración de Riesgos, Seguridad y Salud en el Trabajo) y
--   Economía. Civil, Biomédica, Mecatrónica, Industrial y Multimedia ya
--   existían.
--
-- SE DECLARA LA COMBINACIÓN, NO LOS PARES
--   Todo entra por `oferta_academica` (carrera × materia × laboratorio). Es lo
--   que permite que "Electrónica" se dicte en tres laboratorios y que
--   Biomédica solo la vea en dos de ellos. Con las tablas anteriores esa
--   distinción no se podía expresar.
--
-- IMÁGENES DIAGNÓSTICAS: UNA SOLA MATERIA, DOS LABORATORIOS
--   Llegó escrita de dos formas —"Lab Imágenes Diagnósticas" en Centro de
--   Control y "Laboratorio Imágenes Diagnósticas" en Electrónica— y la
--   División confirmó que es la misma asignatura, dictada con enfoque distinto
--   en cada sitio.
--
--   Eso es exactamente lo que `oferta_academica` sabe representar: UNA fila en
--   `subjects` y DOS en la oferta. El enfoque distinto lo aporta el
--   laboratorio, no un duplicado de la materia. Duplicarla habría partido en
--   dos las horas de práctica de esa asignatura en `v_student_lab_hours`, y el
--   informe del jefe mostraría dos materias donde hay una.
--
-- PROCESAMIENTO DIGITAL: DOS MATERIAS DISTINTAS (confirmado)
--   "Procesamiento Digital de Señales" (Biomédica) y "Procesamiento Digital"
--   (Mecatrónica) son asignaturas diferentes, con enfoque propio en cada
--   carrera. Van separadas a propósito.
--
--   Nótese el contraste con Imágenes Diagnósticas, y que la distinción no es
--   caprichosa: allí una misma asignatura se dicta en dos laboratorios —el
--   enfoque lo da el LUGAR—, aquí son dos asignaturas del plan de estudios que
--   se llaman parecido —el enfoque lo da la CARRERA—. La primera se modela con
--   una materia y dos filas de oferta; la segunda, con dos materias.
--
-- INSTRUMENTACIÓN BIOMÉDICA: TRES ASIGNATURAS (confirmado)
--   "Biosensores", "Instrumentación Biomédica" e "Instrumentación Biomédica y
--   Biosensores" son tres asignaturas distintas del plan de Biomédica, y las
--   tres se cursan en Biomecatrónica. El parecido de los nombres es solo eso.
--
--   Se deja anotado porque a primera vista parece un error de captura —la
--   tercera parece la suma de las dos primeras— y alguien podría "corregirlo"
--   fusionándolas. No lo son.
--
-- IDEMPOTENTE.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Carreras
-- ----------------------------------------------------------------------------
insert into public.programs (code, name) values
  ('ARISST',   'Administración de Riesgos, Seguridad y Salud en el Trabajo'),
  ('ECONOMIA', 'Economía')
on conflict (code) do update set name = excluded.name, is_active = true;


-- ----------------------------------------------------------------------------
-- 2) Laboratorios
-- ----------------------------------------------------------------------------
-- Puede que ya estén en el catálogo de 0003 con otro código. Se insertan por
-- código y, si existen, solo se reactivan.
insert into public.laboratories (code, name) values
  ('ROBOTICA',        'LABORATORIO DE ROBÓTICA'),
  ('CENTRO_CONTROL',  'CENTRO DE CONTROL'),
  ('ELECTRONICA',     'LABORATORIO DE ELECTRÓNICA'),
  ('BIOMECATRONICA',  'LABORATORIO DE BIOMECATRÓNICA')
on conflict (code) do update set is_active = true;


-- ----------------------------------------------------------------------------
-- 3) Materias
-- ----------------------------------------------------------------------------
insert into public.subjects (code, name) values
  -- Electrónica y control
  ('CIRCUITOS',                 'Circuitos'),
  ('CIRCUITOS_ELECTRONICOS',    'Circuitos Electrónicos'),
  ('ELECTRONICA',               'Electrónica'),
  ('DIGITALES',                 'Digitales'),
  ('MICROS',                    'Micros'),
  ('SENSORES',                  'Sensores'),
  ('CONTROL_LINEAL',            'Control Lineal'),
  ('TOPICOS_AVANZADOS_CONTROL', 'Tópicos Avanzados de Control'),
  ('COMUNICACIONES',            'Comunicaciones'),
  ('ELECTRICIDAD_ELECTRONICA',  'Electricidad y Electrónica'),
  -- Robótica y cómputo
  ('ROBOTICA',                  'Robótica'),
  ('INTELIGENCIA_ARTIFICIAL',   'Inteligencia Artificial'),
  ('SISTEMAS_EMBEBIDOS_LAB',    'Sistemas Embebidos y Lab'),
  ('PROCESAMIENTO_DIGITAL',     'Procesamiento Digital'),
  ('ELECTIVA_E_ROS',            'Electiva E (ROS Robot Operating System)'),
  ('ELECTIVA_PHYSICAL_COMP',    'Electiva (Physical Computing)'),
  -- Biomédica
  ('PROC_DIGITAL_SENALES',      'Procesamiento Digital de Señales'),
  ('DIAG_FALLAS_METROLOGIA',    'Diagnóstico de Fallas y Metrología'),
  ('DIAG_FALLAS_PROTOCOLOS',    'Diagnóstico de Fallas y Protocolos'),
  ('LABORATORIO_IMAGENES_DIAG', 'Laboratorio Imágenes Diagnósticas'),
  ('MODELOS_SIST_BIOLOGICOS',   'Modelos de Sistemas Biológicos'),
  ('CONTROL_SIST_FISIOLOGICOS', 'Control de Sistemas Fisiológicos'),
  ('BIOSENSORES',               'Biosensores'),
  ('INSTRUM_BIOMEDICA',         'Instrumentación Biomédica'),
  ('INSTRUM_BIOMEDICA_BIOSENS', 'Instrumentación Biomédica y Biosensores'),
  -- Riesgos y seguridad
  ('PROTECCION_ACTIVOS_I',      'Protección de Activos I'),
  ('PROTECCION_ACTIVOS_II',     'Protección de Activos II'),
  ('PROTECCION_EMPRESARIAL',    'Protección Empresarial'),
  ('GESTION_RIESGOS_FISICA',    'Gestión de Riesgos de Seguridad Física'),
  ('PROTECCION_ELECTRONICA',    'Protección Electrónica'),
  ('SEGURIDAD_INFORMATICA',     'Seguridad Informática'),
  -- Otras
  ('DIBUJO_INGENIERIA',         'Dibujo en Ingeniería'),
  ('MATEMATICA_FINANCIERA',     'Matemática Financiera')
on conflict (code) do update set name = excluded.name, is_active = true;


-- ----------------------------------------------------------------------------
-- 4) La oferta: carrera × materia × laboratorio
-- ----------------------------------------------------------------------------
insert into public.oferta_academica (program_id, subject_id, lab_id)
select p.id, s.id, l.id
  from (values
    -- ── LABORATORIO DE ROBÓTICA ──────────────────────────────────────────
    ('BIOMEDICA',  'CIRCUITOS_ELECTRONICOS',    'ROBOTICA'),
    ('BIOMEDICA',  'ELECTRONICA',               'ROBOTICA'),
    ('BIOMEDICA',  'SISTEMAS_EMBEBIDOS_LAB',    'ROBOTICA'),
    ('BIOMEDICA',  'PROC_DIGITAL_SENALES',      'ROBOTICA'),
    ('BIOMEDICA',  'DIAG_FALLAS_METROLOGIA',    'ROBOTICA'),
    ('MECATRONICA','ROBOTICA',                  'ROBOTICA'),
    ('MECATRONICA','ELECTRONICA',               'ROBOTICA'),
    ('MECATRONICA','CIRCUITOS',                 'ROBOTICA'),
    ('MECATRONICA','MICROS',                    'ROBOTICA'),
    ('MECATRONICA','SENSORES',                  'ROBOTICA'),

    -- ── CENTRO DE CONTROL ────────────────────────────────────────────────
    ('MECATRONICA','COMUNICACIONES',            'CENTRO_CONTROL'),
    ('MECATRONICA','ROBOTICA',                  'CENTRO_CONTROL'),
    ('MECATRONICA','MICROS',                    'CENTRO_CONTROL'),
    ('MECATRONICA','DIGITALES',                 'CENTRO_CONTROL'),
    ('ARISST',     'PROTECCION_ACTIVOS_I',      'CENTRO_CONTROL'),
    ('ARISST',     'PROTECCION_ACTIVOS_II',     'CENTRO_CONTROL'),
    ('ARISST',     'PROTECCION_EMPRESARIAL',    'CENTRO_CONTROL'),
    ('ARISST',     'GESTION_RIESGOS_FISICA',    'CENTRO_CONTROL'),
    ('ARISST',     'PROTECCION_ELECTRONICA',    'CENTRO_CONTROL'),
    ('ARISST',     'SEGURIDAD_INFORMATICA',     'CENTRO_CONTROL'),
    ('CIVIL',      'DIBUJO_INGENIERIA',         'CENTRO_CONTROL'),
    -- Misma materia que en Electrónica; aquí se dicta con otro enfoque.
    ('BIOMEDICA',  'LABORATORIO_IMAGENES_DIAG', 'CENTRO_CONTROL'),
    ('BIOMEDICA',  'MODELOS_SIST_BIOLOGICOS',   'CENTRO_CONTROL'),
    ('BIOMEDICA',  'SISTEMAS_EMBEBIDOS_LAB',    'CENTRO_CONTROL'),
    ('BIOMEDICA',  'CONTROL_SIST_FISIOLOGICOS', 'CENTRO_CONTROL'),
    ('ECONOMIA',   'MATEMATICA_FINANCIERA',     'CENTRO_CONTROL'),

    -- ── LABORATORIO DE ELECTRÓNICA ───────────────────────────────────────
    ('MECATRONICA','DIGITALES',                 'ELECTRONICA'),
    ('MECATRONICA','ELECTRONICA',               'ELECTRONICA'),
    ('MECATRONICA','SENSORES',                  'ELECTRONICA'),
    ('MECATRONICA','INTELIGENCIA_ARTIFICIAL',   'ELECTRONICA'),
    ('MECATRONICA','ROBOTICA',                  'ELECTRONICA'),
    ('MECATRONICA','CONTROL_LINEAL',            'ELECTRONICA'),
    ('MECATRONICA','CIRCUITOS',                 'ELECTRONICA'),
    ('MECATRONICA','PROCESAMIENTO_DIGITAL',     'ELECTRONICA'),
    ('MECATRONICA','TOPICOS_AVANZADOS_CONTROL', 'ELECTRONICA'),
    ('BIOMEDICA',  'ELECTRONICA',               'ELECTRONICA'),
    ('BIOMEDICA',  'LABORATORIO_IMAGENES_DIAG', 'ELECTRONICA'),
    ('INDUSTRIAL', 'ELECTRICIDAD_ELECTRONICA',  'ELECTRONICA'),

    -- ── LABORATORIO DE BIOMECATRÓNICA ────────────────────────────────────
    ('MECATRONICA','CIRCUITOS',                 'BIOMECATRONICA'),
    ('MECATRONICA','ELECTRONICA',               'BIOMECATRONICA'),
    ('MECATRONICA','PROCESAMIENTO_DIGITAL',     'BIOMECATRONICA'),
    ('MECATRONICA','INTELIGENCIA_ARTIFICIAL',   'BIOMECATRONICA'),
    ('MECATRONICA','ELECTIVA_E_ROS',            'BIOMECATRONICA'),
    ('BIOMEDICA',  'BIOSENSORES',               'BIOMECATRONICA'),
    ('BIOMEDICA',  'INSTRUM_BIOMEDICA_BIOSENS', 'BIOMECATRONICA'),
    ('BIOMEDICA',  'DIAG_FALLAS_PROTOCOLOS',    'BIOMECATRONICA'),
    ('BIOMEDICA',  'CIRCUITOS_ELECTRONICOS',    'BIOMECATRONICA'),
    ('BIOMEDICA',  'DIAG_FALLAS_METROLOGIA',    'BIOMECATRONICA'),
    ('BIOMEDICA',  'PROC_DIGITAL_SENALES',      'BIOMECATRONICA'),
    ('BIOMEDICA',  'INSTRUM_BIOMEDICA',         'BIOMECATRONICA'),
    ('MULTIMEDIA', 'ELECTIVA_PHYSICAL_COMP',    'BIOMECATRONICA')
  ) as v(carrera, materia, lab)
  join public.programs     p on p.code = v.carrera
  join public.subjects     s on s.code = v.materia
  join public.laboratories l on l.code = v.lab
on conflict (program_id, subject_id, lab_id) do nothing;


-- ----------------------------------------------------------------------------
-- 4-bis) Fusionar 'Lab Imágenes Diagnósticas' si quedó de una corrida previa
-- ----------------------------------------------------------------------------
-- Una versión anterior de esta migración creaba `LAB_IMAGENES_DIAG` como
-- materia aparte. Si ya se ejecutó, aquí se fusiona con la definitiva en vez de
-- dejar dos asignaturas donde hay una.
--
-- Se repuntan TODAS las referencias antes de borrar, incluidas las reservas: en
-- este proyecto no se borra nada que sostenga métricas. Si no existe, el bloque
-- no hace nada.
do $$
declare
  v_viejo uuid;
  v_nuevo uuid;
begin
  select id into v_viejo from public.subjects where code = 'LAB_IMAGENES_DIAG';
  if v_viejo is null then
    return;
  end if;

  select id into v_nuevo
    from public.subjects where code = 'LABORATORIO_IMAGENES_DIAG';
  if v_nuevo is null then
    raise exception 'No existe LABORATORIO_IMAGENES_DIAG: aplica primero la sección 3.';
  end if;

  -- Reservas ya hechas: conservan su historia apuntando a la materia correcta.
  update public.reservations set subject_id = v_nuevo where subject_id = v_viejo;

  -- Catálogo. `do nothing` porque la fila destino puede existir ya, y en ese
  -- caso lo que corresponde es descartar la duplicada, no fallar.
  insert into public.oferta_academica (program_id, subject_id, lab_id)
  select program_id, v_nuevo, lab_id from public.oferta_academica
   where subject_id = v_viejo
  on conflict (program_id, subject_id, lab_id) do nothing;
  delete from public.oferta_academica where subject_id = v_viejo;

  insert into public.subject_labs (subject_id, lab_id)
  select v_nuevo, lab_id from public.subject_labs where subject_id = v_viejo
  on conflict (subject_id, lab_id) do nothing;
  delete from public.subject_labs where subject_id = v_viejo;

  insert into public.subject_programs (subject_id, program_id)
  select v_nuevo, program_id from public.subject_programs where subject_id = v_viejo
  on conflict (subject_id, program_id) do nothing;
  delete from public.subject_programs where subject_id = v_viejo;

  delete from public.subjects where id = v_viejo;

  raise notice 'Fusionada "Lab Imágenes Diagnósticas" con "Laboratorio Imágenes Diagnósticas".';
end $$;


-- ----------------------------------------------------------------------------
-- 5) Reconstruir las tablas derivadas
-- ----------------------------------------------------------------------------
-- Los RPC en producción todavía consultan `subject_labs` y `subject_programs`.
-- Se reconstruyen desde la oferta para que sigan viendo el catálogo completo.
select public.sincronizar_catalogo_desde_oferta();


-- ============================================================================
-- VERIFICACIÓN
-- ----------------------------------------------------------------------------
-- ⚠️ NINGÚN LABORATORIO NUEVO TIENE HORARIO. Esta migración carga la OFERTA
--    ACADÉMICA, no las franjas. El estudiante podrá llegar hasta el paso 3 y
--    encontrar el calendario vacío hasta que cada laboratorista publique sus
--    bloques desde /panel/horarios. Y para que le lleguen las solicitudes, el
--    jefe debe asignarle el laboratorio desde Personal.
-- ============================================================================
select l.code                                   as laboratorio,
       count(*)                                 as combinaciones,
       count(distinct o.program_id)             as carreras,
       count(distinct o.subject_id)             as materias,
       coalesce((select count(*) from public.schedule_blocks b
                  where b.lab_id = l.id and b.is_active), 0) as bloques_horarios
  from public.oferta_academica o
  join public.laboratories l on l.id = o.lab_id
 where l.code in ('ROBOTICA','CENTRO_CONTROL','ELECTRONICA','BIOMECATRONICA')
 group by l.code, l.id
 order by l.code;


-- Imágenes Diagnósticas: UNA materia en DOS laboratorios. Debe salir una sola
-- fila, con dos laboratorios. Si aparecieran dos materias, la fusión no corrió.
select s.name                                    as materia,
       count(*)                                  as laboratorios,
       string_agg(l.code, ', ' order by l.code)  as cuales
  from public.oferta_academica o
  join public.subjects     s on s.id = o.subject_id
  join public.laboratories l on l.id = o.lab_id
 where s.name ilike '%imágenes diagn%'
 group by s.name
 order by s.name;


-- La prueba de que el modelo nuevo hace lo que debe: la misma materia, dos
-- carreras, distinto número de laboratorios. Con el modelo anterior ambas
-- filas habrían devuelto 3.
select p.code                                    as carrera,
       'Electrónica'                             as materia,
       count(*)                                  as laboratorios,
       string_agg(l.code, ', ' order by l.code)  as cuales
  from public.oferta_academica o
  join public.programs     p on p.id = o.program_id
  join public.subjects     s on s.id = o.subject_id
  join public.laboratories l on l.id = o.lab_id
 where s.code = 'ELECTRONICA' and p.code in ('BIOMEDICA', 'MECATRONICA')
 group by p.code
 order by p.code;
