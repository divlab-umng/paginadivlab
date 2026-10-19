// ============================================================================
// supabase/pruebas/material_requerido.test.mjs — banco de pruebas de 0031
// ----------------------------------------------------------------------------
// Reproduce TODAS las migraciones en PGlite e INVOCA el RPC de verdad (trampa
// 3-bis: que la función exista no prueba que corra).
//
//   npm i -D @electric-sql/pglite      (o --no-save: no va en package.json)
//   node supabase/pruebas/material_requerido.test.mjs
// ============================================================================

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../migrations", import.meta.url).pathname;
const db = new PGlite({ extensions: { pgcrypto } });

// --- Stubs de lo que Supabase aporta y PGlite no ---------------------------
await db.exec(`
  create extension if not exists pgcrypto;
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    encrypted_password text,
    created_at timestamptz default now()
  );
  create table if not exists auth._sesion (uid uuid);
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select uid from auth._sesion limit 1 $$;
  create or replace function auth.role() returns text
    language sql stable as $$ select 'authenticated'::text $$;
  do $$ begin
    create role anon;          exception when duplicate_object then null; end $$;
  do $$ begin
    create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin
    create role service_role;  exception when duplicate_object then null; end $$;

`);

const archivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
let aplicadas = 0;

for (const f of archivos) {
  const sql = readFileSync(`${DIR}/${f}`, "utf8");
  try {
    await db.exec(sql);
    aplicadas++;
  } catch (e) {
    console.log(`\n❌ ${f}\n   ${String(e.message).split("\n")[0]}`);
    process.exit(1);
  }
}
console.log(`✅ ${aplicadas}/${archivos.length} migraciones aplicadas sin error`);
const ultima = archivos[archivos.length - 1];


const q = async (sql, params) => (await db.query(sql, params)).rows;
let fallos = 0;
const check = (nombre, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? " — " + extra : ""}`);
  if (!cond) fallos++;
};

// --- Escenario: Mecatrónica · Electrónica · Biomecatrónica (combinación declarada)
await q(`update public.laboratories set max_group_size = 4 where code = 'BIOMECATRONICA'`);
const [blk] = await q(
  `insert into public.schedule_blocks (lab_id, weekday, start_time, end_time, capacity)
   select id, 3, '09:00', '11:00', 10 from public.laboratories where code='BIOMECATRONICA'
   returning id`
);
const nuevaSesion = async (dias, cap = 10) => (await q(
  `insert into public.block_sessions (block_id, lab_id, session_date, start_time, end_time, capacity)
   select $1, lab_id, current_date + $2::int, '09:00', '11:00', $3
     from public.schedule_blocks where id = $1 returning id`, [blk.id, dias, cap]
))[0].id;
const [{ id: subj }] = await q(`select id from public.subjects where code='ELECTRONICA'`);
const [{ id: prog }] = await q(`select id from public.programs where code='MECATRONICA'`);

// Llamada con argumentos NOMBRADOS, igual que PostgREST / supabase.rpc().
const solicitar = (sid, codigo, extra = "", params = []) => q(
  `select * from public.request_group_reservations_public(
     p_session_ids     := array[$1]::uuid[],
     p_subject_id      := $2,
     p_leader_name     := 'Ana Prueba',
     p_leader_email    := 'ana' || $3 || '@unimilitar.edu.co',
     p_leader_code     := $3,
     p_consent_version := '1.1',
     p_program_id      := $4 ${extra})`,
  [sid, subj, codigo, prog, ...params]
);
const material = async (ids) =>
  (await q(`select material_requerido as m from public.reservations where id = any($1::uuid[])`, [ids]))
    .map((r) => r.m);

// 1. Una sola firma: si quedaran dos, PostgREST respondería PGRST203.
const [{ n }] = await q(
  `select count(*)::int as n from pg_proc where proname = 'request_group_reservations_public'`
);
check("existe UNA sola versión del RPC (sin sobrecarga)", n === 1, `versiones = ${n}`);

// 2. Permisos: anon y authenticated deben poder ejecutarlo.
const [perm] = await q(`select
  has_function_privilege('anon', 'public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text, uuid, text)', 'execute') as anon,
  has_function_privilege('authenticated', 'public.request_group_reservations_public(uuid[], uuid, text, text, text, jsonb, text, uuid, text)', 'execute') as auth`);
check("anon puede ejecutarlo", perm.anon === true);
check("authenticated puede ejecutarlo", perm.auth === true);

// 3. Compatibilidad: el código YA desplegado manda 8 argumentos, sin p_material.
const s1 = await nuevaSesion(7);
const [r1] = await solicitar(s1, "1000001");
check("la llamada vieja (8 args) sigue funcionando", r1?.ok === true, r1?.error ?? "");
check("y deja material_requerido en NULL", (await material(r1.reservation_ids))[0] === null);

// 4. Con material: se guarda recortado de espacios.
const s2 = await nuevaSesion(8);
const [r2] = await solicitar(s2, "1000002", ", p_material := $5", ["  Cámara réflex y buril de 1/4  "]);
check("con material la reserva se crea", r2?.ok === true, r2?.error ?? "");
check("y guarda el texto sin espacios sobrantes",
      (await material(r2.reservation_ids))[0] === "Cámara réflex y buril de 1/4");

// 5. Solo espacios → NULL (no una cadena vacía: trampa 2 del coalesce).
const s3 = await nuevaSesion(9);
const [r3] = await solicitar(s3, "1000003", ", p_material := $5", ["   \n  "]);
check("material en blanco se guarda como NULL", (await material(r3.reservation_ids))[0] === null);

// 6. Más de 500 caracteres → se recorta en el servidor (no confiar en el maxLength).
const s4 = await nuevaSesion(10);
const [r4] = await solicitar(s4, "1000004", ", p_material := $5", ["x".repeat(800)]);
check("el texto se recorta a 500 en el servidor",
      (await material(r4.reservation_ids))[0]?.length === 500);

// 7. Grupo: la nota queda en TODAS las filas (aprobación individual).
const s5 = await nuevaSesion(11);
const [r5] = await solicitar(s5, "1000005", ", p_members := $5::jsonb, p_material := $6", [
  JSON.stringify([
    { nombre: "Beto Prueba", correo: "beto@unimilitar.edu.co", codigo: "1000006" },
    { nombre: "Caro Prueba", correo: "caro@unimilitar.edu.co", codigo: "1000007" },
  ]),
  "Tres calibradores",
]);
const mg = await material(r5.reservation_ids ?? []);
check("grupo de 3: se crean 3 reservas", r5?.ok === true && r5.creadas === 3, r5?.error ?? "");
check("y las 3 llevan la nota", mg.length === 3 && mg.every((m) => m === "Tres calibradores"));

// 8. Las reglas de negocio siguen intactas: aforo y 24 h.
const s6 = await nuevaSesion(12, 1);
await solicitar(s6, "1000008", ", p_material := $5", ["algo"]);
const [r6] = await solicitar(s6, "1000009", ", p_material := $5", ["algo"]);
check("el aforo sigue impidiendo el sobrecupo", r6?.ok === false && /aforo/i.test(r6.error), r6?.error ?? "");
const s7 = await nuevaSesion(0);
const [r7] = await solicitar(s7, "1000010");
check("la regla de 24 h sigue vigente", r7?.ok === false && /24 horas/i.test(r7.error), r7?.error ?? "");

// 9. Idempotencia: volver a pegar la migración completa no duplica nada.
await db.exec(readFileSync(`${DIR}/${ultima}`, "utf8"));
const [{ n: n2 }] = await q(
  `select count(*)::int as n from pg_proc where proname = 'request_group_reservations_public'`
);
check(`reaplicar ${ultima} no deja sobrecargas`, n2 === 1, `versiones = ${n2}`);
const [r8] = await solicitar(await nuevaSesion(13), "1000011", ", p_material := $5", ["ok"]);
check("y el RPC sigue respondiendo tras reaplicarla", r8?.ok === true, r8?.error ?? "");

console.log(fallos === 0 ? "\n🟢 TODO VERDE" : `\n🔴 ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
