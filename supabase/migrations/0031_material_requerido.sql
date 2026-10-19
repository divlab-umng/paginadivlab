-- ============================================================================
-- UMNG · Plataforma de Reserva de Laboratorios (paginadivlab)
-- Migración 0031_material_requerido.sql — OBSERVACIONES / MATERIAL REQUERIDO
-- ----------------------------------------------------------------------------
-- QUÉ AÑADE
--   Un campo de texto libre y OPCIONAL en la solicitud de /reservar para que el
--   estudiante avise si necesita algo del laboratorio (una cámara, un buril,
--   herramientas específicas…). El laboratorista lo lee en la bandeja y en el
--   correo de aviso, y así lo tiene listo el día de la práctica.
--
-- LO QUE NO ES (y no debe llegar a ser)
--   NO es inventario. Sin catálogo de equipos, sin estados de préstamo, sin
--   descuento de stock. Es una NOTA; el préstamo sigue fuera de alcance
--   (AGENTS.md). Si algún día se quiere más que eso, es otro proyecto.
--
-- CÓMO NO ROMPE NADA
--   · Columna nullable, sin default: las reservas existentes quedan en NULL y
--     ninguna vista, métrica ni RPC que ya las lea cambia de comportamiento.
--   · El RPC gana un 9.º parámetro `p_material text DEFAULT NULL`. Por el
--     default, el código que ya está desplegado (que envía 8 argumentos) sigue
--     funcionando contra la función nueva: se puede aplicar ANTES del push.
--   · Cambia la firma → DROP de la de 8 argumentos antes de recrear. Si se
--     dejaran las dos, PostgREST no sabría cuál elegir (PGRST203) y se caerían
--     todas las reservas. El GRANT se vuelve a otorgar (se pierde con el DROP).
--   · Todo va en una transacción: si el CREATE fallara, el DROP se deshace y la
--     función anterior sigue en pie.
--   · El cuerpo es el de 0021 COPIADO LITERAL; solo se añaden la variable
--     v_material y la columna en los dos INSERT (líder y compañeros). Trampa
--     3-bis: diferenciar contra 0021 antes de darla por buena.
--
-- En un grupo, la nota se guarda en TODAS las filas de la solicitud: la
-- aprobación es individual y el laboratorista debe verla en cualquiera.
--
-- Idempotente: se puede volver a pegar completa.
-- ============================================================================

set search_path = public;

begin;

-- 1. Columna --------------------------------------------------------------------
alter table public.reservations
  add column if not exists material_requerido text;

comment on column public.reservations.material_requerido is
  'Nota libre y opcional del estudiante (equipo o material que necesita). No es inventario. Máx. 500 caracteres, recortado en el RPC.';

-- 2. RPC de solicitud con el parámetro nuevo -------------------------------------
drop function if exists public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text, uuid);

create or replace function public.request_group_reservations_public(
  p_session_ids     uuid[],
  p_subject_id      uuid,
  p_leader_name     text,
  p_leader_email    text,
  p_leader_code     text,
  p_members         jsonb default '[]'::jsonb,
  p_consent_version text default null,
  p_program_id      uuid default null,
  p_material        text default null
)
returns table (
  session_id      uuid,
  ok              boolean,
  group_id        uuid,
  creadas         integer,
  error           text,
  reservation_ids uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_ventana_dias constant integer  := 28;
  c_antelacion   constant interval := interval '24 hours';
  c_max_franjas  constant integer  := 10;
  c_max_filas    constant integer  := 40;

  v_consent    text := nullif(btrim(coalesce(p_consent_version, '')), '');
  -- 0031: nota libre del estudiante. En blanco → NULL; se recorta a 500 caracteres.
  -- btrim con la lista explícita: por defecto solo quita espacios, y un textarea
  -- con solo saltos de línea se guardaría como "nota" vacía.
  v_material   text := left(nullif(btrim(coalesce(p_material, ''), E' \t\r\n'), ''), 500);
  v_ids        uuid[];
  v_sid        uuid;
  v_session    public.block_sessions;
  v_lab        public.laboratories;
  v_grupo      uuid;
  v_personas   integer;
  v_puestos    integer;
  v_creadas    integer;
  v_tam        integer;
  v_miembros   jsonb;
  v_m          jsonb;
  v_est        uuid;
  v_student    public.students;
  v_res_ids    uuid[];
  v_new_id     uuid;
begin
  if v_consent is null then
    raise exception 'Debes autorizar el tratamiento de tus datos personales para reservar';
  end if;

  if p_program_id is not null and not exists (
    select 1 from public.subject_programs sp
     where sp.subject_id = p_subject_id and sp.program_id = p_program_id
  ) then
    raise exception 'La materia seleccionada no corresponde a tu carrera';
  end if;

  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_session_ids, '{}'::uuid[])) as t(x)
   where x is not null;

  if v_ids is null or array_length(v_ids, 1) is null then
    raise exception 'No seleccionaste ninguna franja horaria';
  end if;
  if array_length(v_ids, 1) > c_max_franjas then
    raise exception 'Puedes solicitar máximo % franjas por solicitud', c_max_franjas;
  end if;

  select coalesce(jsonb_agg(m), '[]'::jsonb) into v_miembros
  from (
    select distinct on (regexp_replace(m ->> 'codigo', '[^0-9]', '', 'g')) m
    from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) as m
    where regexp_replace(m ->> 'codigo', '[^0-9]', '', 'g')
          <> regexp_replace(coalesce(p_leader_code, ''), '[^0-9]', '', 'g')
  ) s;

  v_tam := 1 + jsonb_array_length(v_miembros);

  if array_length(v_ids, 1) * v_tam > c_max_filas then
    raise exception 'Demasiadas reservas de una vez (% franjas × % personas). Divide la solicitud.',
      array_length(v_ids, 1), v_tam;
  end if;

  foreach v_sid in array v_ids
  loop
    begin
      v_res_ids := '{}'::uuid[];

      select * into v_session from public.block_sessions where id = v_sid for update;
      if not found then raise exception 'La franja ya no existe'; end if;

      select * into v_lab from public.laboratories where id = v_session.lab_id;

      if v_tam > greatest(coalesce(v_lab.max_group_size, 1), 1) then
        if coalesce(v_lab.max_group_size, 1) <= 1 then
          raise exception 'Este laboratorio no admite grupos: cada estudiante reserva individualmente';
        else
          raise exception 'Este laboratorio admite grupos de máximo % personas', v_lab.max_group_size;
        end if;
      end if;

      if not exists (
        select 1 from public.subject_labs sl
         where sl.lab_id = v_session.lab_id and sl.subject_id = p_subject_id
      ) then
        raise exception 'La materia seleccionada no habilita este laboratorio';
      end if;

      if v_session.status <> 'abierta'::session_status then
        raise exception 'La franja no está disponible';
      end if;
      if v_session.session_date > current_date + c_ventana_dias then
        raise exception 'Solo puedes reservar hasta 4 semanas por adelantado';
      end if;
      if ((v_session.session_date + v_session.start_time) at time zone 'America/Bogota')
           < now() + c_antelacion then
        raise exception 'Debes reservar con al menos 24 horas de anticipación';
      end if;

      select o.personas, o.puestos into v_personas, v_puestos
        from public.session_occupancy(v_sid) o;

      if v_personas + v_tam > v_session.capacity then
        raise exception 'No hay aforo suficiente: quedan % cupos y son % personas',
          greatest(v_session.capacity - v_personas, 0), v_tam;
      end if;

      if v_session.workstations is not null
         and v_puestos + 1 > v_session.workstations then
        raise exception 'No quedan puestos de trabajo disponibles en esta franja';
      end if;

      v_grupo := case when v_tam > 1 then gen_random_uuid() else null end;
      v_creadas := 0;

      v_est := public.upsert_student(p_leader_code, p_leader_name, p_leader_email);
      select * into v_student from public.students where id = v_est;

      update public.students
         set consent_version = v_consent, consent_accepted_at = now()
       where id = v_est;

      if exists (
        select 1 from public.reservations r
         where r.session_id = v_sid and r.student_ref = v_est
           and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
      ) then
        raise exception 'Ya tienes una reserva activa para esta franja';
      end if;

      insert into public.reservations
        (session_id, student_id, student_ref, subject_id, program_id, group_id, is_group_leader,
         student_name, student_email, student_code, status,
         consent_version, consent_accepted_at, consent_self, material_requerido)
      values
        (v_sid, null, v_est, p_subject_id, p_program_id, v_grupo, (v_tam > 1),
         v_student.full_name, v_student.email, v_student.student_code,
         'pendiente'::reservation_status,
         v_consent, now(), true, v_material)
      returning id into v_new_id;
      v_res_ids := v_res_ids || v_new_id;
      v_creadas := v_creadas + 1;

      for v_m in select * from jsonb_array_elements(v_miembros)
      loop
        v_est := public.upsert_student(
          v_m ->> 'codigo', v_m ->> 'nombre', v_m ->> 'correo'
        );
        select * into v_student from public.students where id = v_est;

        if exists (
          select 1 from public.reservations r
           where r.session_id = v_sid and r.student_ref = v_est
             and r.status in ('pendiente'::reservation_status, 'aprobada'::reservation_status)
        ) then
          raise exception 'El estudiante % ya tiene una reserva activa en esta franja',
            v_student.full_name;
        end if;

        insert into public.reservations
          (session_id, student_id, student_ref, subject_id, program_id, group_id, is_group_leader,
           student_name, student_email, student_code, status,
           consent_version, consent_accepted_at, consent_self, material_requerido)
        values
          (v_sid, null, v_est, p_subject_id, p_program_id, v_grupo, false,
           v_student.full_name, v_student.email, v_student.student_code,
           'pendiente'::reservation_status,
           v_consent, now(), false, v_material)
        returning id into v_new_id;
        v_res_ids := v_res_ids || v_new_id;
        v_creadas := v_creadas + 1;
      end loop;

      session_id := v_sid; ok := true; group_id := v_grupo;
      creadas := v_creadas; error := null; reservation_ids := v_res_ids;
      return next;

    exception when others then
      session_id := v_sid; ok := false; group_id := null;
      creadas := 0; error := sqlerrm; reservation_ids := '{}'::uuid[];
      return next;
    end;
  end loop;
end;
$$;

grant execute on function public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text, uuid, text)
  to anon, authenticated;

commit;

-- Que PostgREST vea la firma nueva sin esperar a su recarga periódica.
notify pgrst, 'reload schema';
