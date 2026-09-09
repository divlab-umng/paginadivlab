-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0029_oferta_academica.sql — CARRERA × MATERIA × LABORATORIO
-- ----------------------------------------------------------------------------
-- CORRIGE UN DEFECTO DEL MODELO, no un error de programación.
--
-- EL PROBLEMA
--   La oferta se describía con DOS relaciones independientes:
--
--       subject_programs :  materia → carreras
--       subject_labs     :  materia → laboratorios
--
--   El formulario las encadena —carrera, luego materia, luego laboratorio—
--   pero el último paso no sabe qué carrera se eligió. Mientras cada materia
--   vivió en un solo laboratorio nadie lo notó. Con la oferta real deja de
--   funcionar:
--
--       "Electrónica" se dicta en Robótica, Electrónica y Biomecatrónica.
--       Biomédica la cursa en las dos primeras; en Biomecatrónica, solo
--       Mecatrónica.
--
--   Con dos relaciones sueltas, un estudiante de Biomédica que elige
--   Electrónica ve Biomecatrónica entre sus opciones y puede reservar ahí. El
--   modelo no puede expresar "esta materia, PARA ESTA CARRERA, se dicta en
--   estos laboratorios": solo sabe unir por materia, y produce el producto
--   cruzado de todo lo declarado.
--
-- LA CORRECCIÓN
--   Una tabla de tres columnas en vez de dos de dos. `oferta_academica` ES la
--   oferta: "Biomédica cursa Electrónica en el laboratorio de Robótica". Un
--   cruce que nadie declaró deja de existir en vez de deducirse.
--
-- ESCALA
--   Los 4 laboratorios de esta tanda son ~51 filas; 50 laboratorios rondarían
--   las 600. Con el índice compuesto, resolver la oferta de una carrera es una
--   búsqueda directa sobre unas decenas de filas, sin importar cuántos
--   laboratorios existan en total.
--
-- COMPATIBILIDAD
--   `subject_labs` y `subject_programs` NO se eliminan: varios RPC en
--   producción las consultan. Pasan a ser DERIVADAS de `oferta_academica`
--   mediante `sincronizar_catalogo_desde_oferta()`. La fuente de verdad es
--   una sola; las otras dos son proyecciones que se reconstruyen.
--
-- IDEMPOTENTE.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) La tabla
-- ----------------------------------------------------------------------------
create table if not exists public.oferta_academica (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id)      on delete cascade,
  subject_id uuid not null references public.subjects(id)      on delete cascade,
  lab_id     uuid not null references public.laboratories(id)  on delete cascade,
  created_at timestamptz not null default now(),
  unique (program_id, subject_id, lab_id)
);

comment on table public.oferta_academica is
  'Qué carrera cursa qué materia en qué laboratorio. Fuente de verdad de la cascada; subject_labs y subject_programs se derivan de aquí.';

-- El índice del unique ya sirve para (program_id, subject_id, …), que es el
-- acceso del formulario. Este otro cubre el sentido inverso: qué se dicta en un
-- laboratorio, que es lo que consultan el panel y los informes.
create index if not exists idx_oferta_lab on public.oferta_academica (lab_id);


-- ----------------------------------------------------------------------------
-- 2) Relleno con lo que ya existe
-- ----------------------------------------------------------------------------
-- El producto cruzado de las dos tablas actuales es, exactamente, lo que la
-- aplicación ofrece hoy. Partir de ahí garantiza que ninguna combinación que
-- hoy funciona deje de funcionar: la migración no cambia comportamiento, solo
-- hace explícito lo que estaba implícito. Lo que se gana es que a partir de
-- ahora se puede declarar MENOS que el producto cruzado.
insert into public.oferta_academica (program_id, subject_id, lab_id)
select sp.program_id, sp.subject_id, sl.lab_id
  from public.subject_programs sp
  join public.subject_labs     sl on sl.subject_id = sp.subject_id
on conflict (program_id, subject_id, lab_id) do nothing;


-- ----------------------------------------------------------------------------
-- 3) RLS y permisos
-- ----------------------------------------------------------------------------
-- Mismo criterio que el resto del catálogo (0009): lectura para todos, incluido
-- `anon`, porque el formulario público la necesita antes de que nadie inicie
-- sesión. Escritura solo para el jefe.
alter table public.oferta_academica enable row level security;

drop policy if exists oferta_select on public.oferta_academica;
create policy oferta_select on public.oferta_academica
  for select using (true);

drop policy if exists oferta_write on public.oferta_academica;
create policy oferta_write on public.oferta_academica
  for all using (public.is_jefe()) with check (public.is_jefe());

grant select on public.oferta_academica to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 4) La cascada, en una sola llamada por carrera
-- ----------------------------------------------------------------------------
-- El formulario NO carga el catálogo entero. Con 50 laboratorios eso serían
-- cientos de filas viajando al celular de cada estudiante para mostrar las
-- pocas de su carrera.
--
-- En su lugar: la portada trae las carreras (una lista corta que no crece con
-- los laboratorios) y, al elegir una, esta función devuelve de golpe sus
-- materias con los laboratorios de cada una. El tamaño de la respuesta depende
-- del plan de estudios de esa carrera, no de cuántos laboratorios existan.
create or replace function public.oferta_de_carrera(p_program_id uuid)
returns table (
  subject_id   uuid,
  subject_code text,
  subject_name text,
  lab_code     text,
  lab_name     text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.code, s.name, l.code, l.name
    from public.oferta_academica o
    join public.subjects     s on s.id = o.subject_id and s.is_active
    join public.laboratories l on l.id = o.lab_id     and l.is_active
   where o.program_id = p_program_id
   order by s.name, l.name;
$$;

revoke all on function public.oferta_de_carrera(uuid) from public;
grant execute on function public.oferta_de_carrera(uuid) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5) La validación, como trigger y no dentro de un RPC
-- ----------------------------------------------------------------------------
-- `request_group_reservations_public` ya comprueba por separado que la materia
-- corresponda a la carrera y que habilite el laboratorio. Esas dos condiciones
-- juntas siguen siendo más laxas que la combinación real: aceptan cruces que
-- nadie declaró.
--
-- Se corrige con un trigger y NO reescribiendo esa función, por dos razones:
--
--   1) La restricción pertenece a los datos, no a una puerta de entrada. Así
--      se aplica también al walk-in y a cualquier camino futuro, sin que nadie
--      tenga que acordarse de replicar la comprobación.
--   2) Esa función tiene 204 líneas de plpgsql. Reescribirla entera para
--      cambiar cuatro es exactamente la maniobra que en este proyecto ya tumbó
--      el calendario: `create or replace function` valida la sintaxis, no que
--      las referencias existan.
--
-- Solo actúa cuando la reserva declara AMBOS datos. Con `program_id` nulo no
-- hay nada que contrastar: es el caso del walk-in sin carrera, que sigue
-- siendo válido.
create or replace function public.validar_oferta_reserva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.program_id is null or new.subject_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.oferta_academica o
      join public.block_sessions   bs on bs.id = new.session_id
     where o.program_id = new.program_id
       and o.subject_id = new.subject_id
       and o.lab_id     = bs.lab_id
  ) then
    raise exception
      'Tu carrera no cursa esta materia en este laboratorio.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_oferta on public.reservations;
create trigger trg_validar_oferta
  before insert on public.reservations
  for each row execute function public.validar_oferta_reserva();


-- ----------------------------------------------------------------------------
-- 6) Reconstruir las tablas derivadas
-- ----------------------------------------------------------------------------
-- `subject_labs` y `subject_programs` quedan como proyecciones de
-- `oferta_academica`. Se rehacen con esta función después de cada siembra, en
-- vez de mantenerlas a mano: dos fuentes de verdad que hay que recordar
-- actualizar siempre acaban divergiendo.
--
-- Solo AÑADE. Borrar filas que ya no se derivan podría invalidar reservas
-- históricas cuyo laboratorio o carrera cambiaron de oferta, y este proyecto
-- no borra datos que sostienen métricas.
create or replace function public.sincronizar_catalogo_desde_oferta()
returns void
language sql
security definer
set search_path = public
as $$
  with a as (
    insert into public.subject_labs (subject_id, lab_id)
    select distinct o.subject_id, o.lab_id from public.oferta_academica o
    on conflict (subject_id, lab_id) do nothing
    returning 1
  ), b as (
    insert into public.subject_programs (subject_id, program_id)
    select distinct o.subject_id, o.program_id from public.oferta_academica o
    on conflict (subject_id, program_id) do nothing
    returning 1
  )
  select;
$$;

revoke all on function public.sincronizar_catalogo_desde_oferta() from public;
grant execute on function public.sincronizar_catalogo_desde_oferta() to authenticated;


-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
select 'tabla oferta_academica' as objeto,
       case when to_regclass('public.oferta_academica') is not null
            then 'OK' else '*** FALTA ***' end as estado
union all
select 'filas migradas desde el catálogo actual',
       count(*)::text from public.oferta_academica
union all
select 'funcion oferta_de_carrera',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                          where n.nspname='public' and p.proname='oferta_de_carrera')
            then 'OK' else '*** FALTA ***' end
union all
select 'trigger de validacion',
       case when exists (select 1 from pg_trigger
                          where tgname = 'trg_validar_oferta' and not tgisinternal)
            then 'OK' else '*** FALTA ***' end
union all
select 'GRANT de lectura a anon',
       case when has_table_privilege('anon', 'public.oferta_academica', 'select')
            then 'OK' else '*** FALTA ***' end
order by 1;
