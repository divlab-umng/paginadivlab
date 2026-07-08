-- 0005_fix_decide_reservation.sql
-- Fix: la columna status es de tipo enum reservation_status. El CASE devolvía
-- text y Postgres no lo casteaba solo en el UPDATE ("column status is of type
-- reservation_status but expression is of type text"). Se agrega cast explícito.
create or replace function public.decide_reservation(
  p_reservation_id uuid,
  p_approve        boolean,
  p_reason         text default null
)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare v_res public.reservations; v_lab uuid;
begin
  select s.lab_id into v_lab
    from public.reservations r
    join public.block_sessions s on s.id = r.session_id
   where r.id = p_reservation_id
   for update;

  select * into v_res from public.reservations where id = p_reservation_id;
  if not found then raise exception 'Reserva no encontrada'; end if;
  if not (public.is_lab_admin(v_lab) or public.is_jefe()) then
    raise exception 'No administras este laboratorio';
  end if;
  if v_res.status <> 'pendiente' then
    raise exception 'Solo se pueden decidir reservas pendientes';
  end if;

  update public.reservations
     set status          = (case when p_approve then 'aprobada' else 'rechazada' end)::public.reservation_status,
         decision_reason = p_reason,
         decided_by      = auth.uid(),
         decided_at      = now()
   where id = p_reservation_id
   returning * into v_res;
  return v_res;
end;
$$;
