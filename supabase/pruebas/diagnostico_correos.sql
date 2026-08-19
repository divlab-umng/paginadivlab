-- ============================================================================
-- DIAGNÓSTICO — ¿por qué a algunos laboratoristas no les llegan los correos?
-- ----------------------------------------------------------------------------
-- NO es una migración. Pégalo en el SQL Editor de Supabase y dale Run.
-- Solo lee: no modifica nada.
--
-- CÓMO DECIDE EL SISTEMA A QUIÉN AVISAR
--   `reservation_notification_targets` (migración 0021) cruza tres cosas:
--
--       reservations → block_sessions → lab_admins → profiles
--                                                    where role = 'laboratorista'
--                                                      and email no es vacío
--
--   Es decir: para recibir el aviso de una solicitud hay que cumplir TRES
--   condiciones a la vez. Basta que falle una para que no llegue nada, y el
--   sistema no avisa de su propio silencio: simplemente no envía.
--
--       1) Estar en `lab_admins` para ESE laboratorio.
--       2) Tener `profiles.role = 'laboratorista'` exactamente.
--          Un 'jefe' asignado a un lab NO recibe avisos: el filtro lo excluye.
--       3) Tener correo no vacío en `profiles`.
--
--   Esta consulta evalúa las tres por laboratorio y dice cuál falla.
--
-- SI TODO SALE "OK · recibe avisos" Y AUN ASÍ NO LLEGAN
--   Entonces el problema no está en la base de datos sino en el envío. Revisa,
--   en este orden:
--     · Vercel → Settings → Environment Variables: que RESEND_API_KEY exista
--       en Production. Es lo primero que hay que descartar.
--     · Vercel → Logs, filtrando por "[email]": el código registra ahí cada
--       envío fallido con su motivo.
--     · Resend → Logs: si el correo salió pero rebotó, aparece ahí con el
--       motivo del rechazo (buzón lleno, dirección inexistente, spam).
--     · La carpeta de spam del destinatario. Con SPF, DKIM y DMARC publicados
--       es poco probable, pero conviene mirarla antes de seguir buscando.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Por laboratorio: ¿quién recibe los avisos y quién no?
-- ----------------------------------------------------------------------------
-- Se listan solo los laboratorios que tienen horario publicado: son los únicos
-- donde un estudiante puede llegar a solicitar algo.
-- OJO CON EL ENUM: `profiles.role` es de tipo `user_role`, no texto. Cualquier
-- coalesce o concatenación contra una cadena suelta hay que hacerlo sobre
-- `p.role::text`, o Postgres intenta convertir esa cadena a un valor del enum y
-- aborta con "invalid input value for enum user_role".
select
  l.code                                     as laboratorio,
  l.name,
  coalesce(p.email, '(nadie asignado)')      as persona,
  coalesce(p.role::text, '—')                as rol,
  case
    when p.id is null
      then '*** NADIE ASIGNADO — este lab no notifica a nadie ***'
    when nullif(btrim(coalesce(p.email, '')), '') is null
      then '*** SIN CORREO en profiles ***'
    when p.role is distinct from 'laboratorista'::user_role
      then '*** ROL ' || upper(coalesce(p.role::text, 'nulo')) || ' — solo se notifica a role=laboratorista ***'
    else 'OK · recibe avisos'
  end                                        as diagnostico
from public.laboratories l
join (select distinct lab_id
        from public.schedule_blocks
       where is_active) b on b.lab_id = l.id
left join public.lab_admins la on la.lab_id = l.id
left join public.profiles   p  on p.id = la.admin_id
order by l.code, p.email;


-- ----------------------------------------------------------------------------
-- 2) Todo el personal registrado, con su estado
-- ----------------------------------------------------------------------------
-- Útil para ver de un vistazo quién quedó a medio configurar: cuentas creadas
-- que nunca recibieron rol, o laboratoristas con rol pero sin ningún lab.
-- Descomenta y ejecútala seleccionándola con el mouse.
--
-- select
--   p.email,
--   coalesce(nullif(btrim(p.full_name), ''), '(sin nombre)') as nombre,
--   p.role::text                                              as rol,
--   count(la.lab_id)                                          as labs_asignados,
--   string_agg(l.code, ', ' order by l.code)                  as cuales,
--   case
--     when p.role = 'laboratorista'::user_role and count(la.lab_id) = 0
--       then '*** laboratorista SIN laboratorios — no recibe nada ***'
--     when p.role = 'estudiante'::user_role
--       then 'cuenta sin aprobar por el jefe'
--     else 'OK'
--   end                                                       as diagnostico
-- from public.profiles p
-- left join public.lab_admins   la on la.admin_id = p.id
-- left join public.laboratories l  on l.id = la.lab_id
-- group by p.id, p.email, p.full_name, p.role
-- order by p.role, p.email;
