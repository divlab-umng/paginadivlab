// app/(jefe)/dashboard/export/route.ts — descarga del reporte de reservas en .xlsx
//
// Se genera en el SERVIDOR, no en el navegador: así la consulta pasa por la
// sesión real del jefe y la RLS decide qué filas salen. Si se armara en el
// cliente habría que exponer los datos primero.
//
// Filtro opcional por semestre:  /dashboard/export?semestre=2026-II
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/supabase/roles";
import { generarXlsx, type Celda } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

type FilaDetalle = {
  semestre: string;
  session_date: string;
  start_time: string;
  end_time: string;
  horas: number;
  lab_code: string;
  lab_name: string;
  materia: string | null;
  codigo_estudiante: string | null;
  estudiante: string | null;
  correo: string | null;
  estado: string;
  asistio: boolean | null;
  solicitada_en: string;
  decidida_en: string | null;
  motivo_decision: string | null;
  decidida_por: string | null;
};

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** ISO → "05/08/2026 10:35" en hora de Colombia. */
function fechaHora(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Asistencia: null = sin registrar. No es lo mismo que "no asistió". */
function textoAsistencia(v: boolean | null) {
  if (v === null || v === undefined) return "Sin registrar";
  return v ? "Sí" : "No";
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const role = await getUserRole(supabase, user.id);
  if (role !== "jefe") {
    return NextResponse.json({ error: "Solo el jefe puede exportar" }, { status: 403 });
  }

  const semestre = request.nextUrl.searchParams.get("semestre");

  let consulta = supabase
    .from("v_reservas_detalle")
    .select("*")
    .order("session_date", { ascending: false })
    .order("start_time", { ascending: true });

  if (semestre) consulta = consulta.eq("semestre", semestre);

  const { data, error } = await consulta;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const filas = (data ?? []) as FilaDetalle[];

  const columnas = [
    { header: "Semestre", width: 11 },
    { header: "Fecha", width: 12 },
    { header: "Inicio", width: 9 },
    { header: "Fin", width: 9 },
    { header: "Horas", width: 8 },
    { header: "Código lab", width: 24 },
    { header: "Laboratorio", width: 42 },
    { header: "Materia", width: 24 },
    { header: "Código estudiante", width: 18 },
    { header: "Estudiante", width: 30 },
    { header: "Correo", width: 34 },
    { header: "Estado", width: 12 },
    { header: "Asistió", width: 13 },
    { header: "Solicitada", width: 18 },
    { header: "Decidida", width: 18 },
    { header: "Decidida por", width: 26 },
    { header: "Motivo", width: 34 },
  ];

  const cuerpo: Celda[][] = filas.map((r) => [
    r.semestre,
    r.session_date,
    hhmm(r.start_time),
    hhmm(r.end_time),
    Number(r.horas),
    r.lab_code,
    r.lab_name,
    r.materia ?? "",
    r.codigo_estudiante ?? "",
    r.estudiante ?? "",
    r.correo ?? "",
    r.estado,
    textoAsistencia(r.asistio),
    fechaHora(r.solicitada_en),
    fechaHora(r.decidida_en),
    r.decidida_por ?? "",
    r.motivo_decision ?? "",
  ]);

  const xlsx = generarXlsx({
    nombreHoja: semestre ? `Reservas ${semestre}` : "Reservas",
    columnas,
    filas: cuerpo,
  });

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(
    new Date()
  ); // YYYY-MM-DD
  const nombre = `reservas-laboratorios-umng${semestre ? `-${semestre}` : ""}-${hoy}.xlsx`;

  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
