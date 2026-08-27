// supabase/pruebas/walk_in.test.mjs
// ============================================================================
// BANCO DE PRUEBAS — entrada inmediata (walk-in) sobre Postgres REAL
// ----------------------------------------------------------------------------
// POR QUÉ EXISTE
//   `create or replace function` valida la sintaxis, no que las referencias
//   existan. Una función puede instalarse en verde y reventar al primer
//   llamado: eso ya pasó una vez y dejó el calendario caído para todos los
//   laboratorios. Ni el build de Next.js ni el typecheck miran dentro de una
//   función de Postgres.
//
//   La única forma de saber si un RPC corre es correrlo. PGlite es Postgres de
//   verdad compilado a WebAssembly: replica las 26 migraciones desde cero en
//   memoria, sin tocar Supabase ni necesitar red.
//
// CÓMO EJECUTARLO
//   npm i -D @electric-sql/pglite      (no está en package.json a propósito:
//                                       es una herramienta de desarrollo, no
//                                       una dependencia de la aplicación)
//   node supabase/pruebas/walk_in.test.mjs
//
//   Sale 0 si todo pasa, 1 si algo falla.
//
// QUÉ COMPRUEBA
//   · Que las 26 migraciones se apliquen en orden sin error.
//   · Que el walk-in nazca aprobado, con asistencia y ligado a `students`.
//   · Que reconozca una reserva previa en vez de duplicarla.
//   · Que se niegue con el aforo lleno y ante un estudiante desconocido.
//   · Que bloquee a un laboratorista de otro laboratorio.
//   · Que el bloque comodín NO aparezca en el calendario del estudiante
//     pero SÍ en el panel de asistencia.
//   · Que la práctica sume en `v_student_lab_hours`.
//
// LA RUTA DE LAS MIGRACIONES está abajo en DIR: ajústala si ejecutas el script
// desde otro directorio.
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

// --- Escenario ------------------------------------------------------------
const q = async (sql, params) => (await db.query(sql, params)).rows;

// Un laboratorista dueño del lab CIM.
const [{ id: uid }] = await q(
  `insert into auth.users (email) values ('lab@unimilitar.edu.co') returning id`
);
const [{ id: otro }] = await q(
  `insert into auth.users (email) values ('otro@unimilitar.edu.co') returning id`
);
await q(`update public.profiles set role = 'laboratorista' where id in ($1,$2)`, [uid, otro]);
const [{ id: labId }] = await q(
  `select id from public.laboratories where code = 'CIM'`
);
await q(`insert into public.lab_admins (lab_id, admin_id) values ($1,$2)`, [labId, uid]);
await q(`insert into auth._sesion (uid) values ($1)`, [uid]);

const llamar = (args) =>
  q(
    `select * from public.register_walk_in_attendance($1,$2,$3,$4,$5,$6,$7)`,
    args
  );

let fallos = 0;
const check = (nombre, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${nombre}${extra ? " — " + extra : ""}`);
  if (!cond) fallos++;
};

// 1. Estudiante nuevo, sin sesión programada en curso → comodín.
try {
  const [r] = await llamar([
    "CIM", "5601330", "Juana Prueba", "juana@unimilitar.edu.co", null, null, "1.1",
  ]);
  check("registra un walk-in nuevo", !!r.reservation_id);
  check("usa el bloque comodín", r.es_comodin === true);
  check("no lo marca como reserva previa", r.ya_tenia_reserva === false);
  check("informa cupos restantes", r.cupos_restantes === 19, `= ${r.cupos_restantes}`);
} catch (e) {
  check("registra un walk-in nuevo", false, e.message.split("\n")[0]);
}

// 2. La reserva quedó aprobada, con asistencia y ligada al estudiante canónico.
const [res] = await q(
  `select r.status::text, r.attended, r.checked_in_at is not null as tiene_hora,
          r.student_ref is not null as tiene_ref, r.consent_version, r.consent_self
     from public.reservations r order by r.created_at desc limit 1`
);
check("nace aprobada", res.status === "aprobada", res.status);
check("con asistencia marcada", res.attended === true);
check("con hora de ingreso", res.tiene_hora === true);
check("ligada a students (métricas)", res.tiene_ref === true);
check("guarda la versión de consentimiento", res.consent_version === "1.1");
check("marca que no lo dio el titular", res.consent_self === false);

// 3. El mismo estudiante otra vez → detecta la reserva previa, no duplica.
try {
  const [r2] = await llamar([
    "CIM", "5601330", null, null, null, null, "1.1",
  ]);
  check("segundo intento reconoce la reserva previa", r2.ya_tenia_reserva === true);
  const [{ n }] = await q(
    `select count(*)::int as n from public.reservations where student_code = '5601330'`
  );
  check("no duplica la reserva", n === 1, `filas = ${n}`);
} catch (e) {
  check("segundo intento reconoce la reserva previa", false, e.message.split("\n")[0]);
}

// 4. Estudiante desconocido sin nombre ni correo → se niega con mensaje claro.
try {
  await llamar(["CIM", "9999999", null, null, null, null, "1.1"]);
  check("exige datos de un estudiante desconocido", false, "no lanzó error");
} catch (e) {
  check("exige datos de un estudiante desconocido", /no registrado/i.test(e.message));
}

// 5. Aforo lleno.
await q(
  `update public.block_sessions set capacity = 1
    where id = (select id from public.block_sessions order by created_at desc limit 1)`
);
try {
  await llamar([
    "CIM", "7777777", "Otro Estudiante", "otro@unimilitar.edu.co", null, null, "1.1",
  ]);
  check("rechaza cuando el aforo está lleno", false, "no lanzó error");
} catch (e) {
  check("rechaza cuando el aforo está lleno", /aforo lleno/i.test(e.message),
        e.message.split("\n")[0].slice(0, 70));
}

// 6. Un laboratorista de OTRO lab no puede registrar aquí.
await q(`update auth._sesion set uid = $1`, [otro]);
try {
  await llamar(["CIM", "1111111", "X Y", "x@unimilitar.edu.co", null, null, "1.1"]);
  check("bloquea a quien no administra el lab", false, "no lanzó error");
} catch (e) {
  check("bloquea a quien no administra el lab", /No autorizado/i.test(e.message));
}
await q(`update auth._sesion set uid = $1`, [uid]);

// 7. El comodín NO aparece en el calendario del estudiante.
const cal = await q(
  `select * from public.lab_sessions_public('CIM', current_date, current_date + 7)`
);
const [{ id: comodinBlk }] = await q(
  `select id from public.schedule_blocks where lab_id = $1 and is_walk_in`, [labId]
);
const [{ n: sesComodin }] = await q(
  `select count(*)::int as n from public.block_sessions where block_id = $1`, [comodinBlk]
);
check("el comodín existe como sesión", sesComodin === 1);
check("pero el calendario no lo ofrece",
      !cal.some((s) => s.start_time === "06:00:00" && s.end_time === "22:00:00"),
      `${cal.length} franjas visibles`);

// 8. La sesión del walk-in aparece en el panel de asistencia.
const asist = await q(`select * from public.attendance_sessions()`);
check("aparece en el panel de asistencia", asist.length > 0, `${asist.length} sesiones`);

// 9. Métricas: cuenta en v_student_lab_hours.
const horas = await q(
  `select * from public.v_student_lab_hours where student_code = '5601330'`
).catch(() => []);
check("suma en las métricas por estudiante", horas.length > 0,
      horas.length ? `${horas[0].lab_code}` : "sin filas");


// --- Vía pública: el estudiante se anuncia solo -----------------------------
// Se restaura el aforo: la prueba 5 lo dejó en 1 a propósito para verificar el
// rechazo, y aquí interesa el camino feliz.
await q(`update public.block_sessions set capacity = 20`);

// Se ejecuta SIN sesión (auth.uid() = null), como haría el rol `anon`.
await q(`update auth._sesion set uid = null`);

const publico = (args) =>
  q(`select * from public.request_walk_in_public($1,$2,$3,$4,$5,$6,$7)`, args);

try {
  const [r] = await publico([
    "CIM", "8080808", "Publico Prueba", "publico@unimilitar.edu.co", null, null, "1.1",
  ]);
  check("un estudiante se anuncia sin sesión", !!r.reservation_id);
  check("no lo marca como ya anunciado", r.ya_anunciado === false);
} catch (e) {
  check("un estudiante se anuncia sin sesión", false, e.message.split("\n")[0]);
}

const [pub] = await q(
  `select r.status::text, r.attended, r.checked_in_at, r.consent_self
     from public.reservations r where r.student_code = '8080808'`
);
check("queda PENDIENTE, no aprobada", pub.status === "pendiente", pub.status);
check("SIN asistencia marcada", pub.attended === null);
check("sin hora de ingreso", pub.checked_in_at === null);
check("consent_self = true (lo dio el titular)", pub.consent_self === true);

// Doble toque: devuelve lo mismo, no duplica.
const [r2] = await publico([
  "CIM", "8080808", "Publico Prueba", "publico@unimilitar.edu.co", null, null, "1.1",
]);
check("el segundo toque no duplica", r2.ya_anunciado === true);

// Sin autorización de datos, se niega.
try {
  await publico(["CIM", "6060606", "Sin Consent", "sc@unimilitar.edu.co", null, null, null]);
  check("exige autorización de datos", false, "no lanzó error");
} catch (e) {
  check("exige autorización de datos", /autorizar el tratamiento/i.test(e.message));
}

// Correo no institucional, se niega.
try {
  await publico(["CIM", "5050505", "Correo Malo", "alguien@gmail.com", null, null, "1.1"]);
  check("exige correo institucional", false, "no lanzó error");
} catch (e) {
  check("exige correo institucional", /institucional/i.test(e.message));
}

// --- El laboratorista confirma al que se anunció ----------------------------
await q(`update auth._sesion set uid = $1`, [uid]);
try {
  const [conf] = await llamar([
    "CIM", "8080808", null, null, null, null, "1.1",
  ]);
  check("el laboratorista confirma al anunciado", conf.ya_tenia_reserva === true);
  const [fin] = await q(
    `select r.status::text, r.attended, r.checked_in_at is not null as hora
       from public.reservations r where r.student_code = '8080808'`
  );
  check("pasa a aprobada", fin.status === "aprobada", fin.status);
  check("con asistencia marcada", fin.attended === true);
  check("y hora de ingreso", fin.hora === true);
} catch (e) {
  check("el laboratorista confirma al anunciado", false, e.message.split("\n")[0]);
}

console.log(fallos === 0 ? "\n🟢 TODO VERDE" : `\n🔴 ${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
