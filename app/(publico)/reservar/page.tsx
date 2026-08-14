// app/(publico)/reservar/page.tsx — entrada pública del estudiante (sin login).
// Server Component: carga materias activas y el mapeo Materia→Laboratorio con el
// cliente anónimo de Supabase (RLS permite leer el catálogo a `anon`), y los
// entrega al wizard (Client Component) que maneja el flujo por pasos.
import { createClient } from "@/lib/supabase/server";
import { ReservaWizard } from "@/components/publico/reserva-wizard";
import type {
  Subject,
  LabsBySubject,
  Program,
  SubjectsByProgram,
} from "@/components/publico/reserva-wizard";

export const metadata = {
  title: "Reservar laboratorio · UMNG",
  description:
    "Solicita tu práctica de laboratorio en la Universidad Militar Nueva Granada sin necesidad de crear una cuenta.",
};

type SubjectLabRow = {
  subject_id: string;
  laboratories: { code: string; name: string; is_active: boolean } | null;
};

export default async function ReservarPage() {
  const supabase = await createClient();

  const [
    { data: subjectsData, error: subjErr },
    { data: mapData, error: mapErr },
    { data: programsData, error: progErr },
    { data: progMapData, error: progMapErr },
  ] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, code, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("subject_labs")
      .select("subject_id, laboratories(code, name, is_active)"),
    supabase
      .from("programs")
      .select("id, code, name")
      .eq("is_active", true)
      .order("name"),
    supabase.from("subject_programs").select("subject_id, program_id"),
  ]);

  if (subjErr || mapErr || progErr || progMapErr) {
    return (
      <section className="mx-auto max-w-2xl px-5 py-16">
        <div className="card-elevated p-6">
          <h1 className="text-xl">No pudimos cargar las materias</h1>
          <p className="mt-2 text-sm text-[var(--umng-muted)]">
            {subjErr?.message ??
              mapErr?.message ??
              progErr?.message ??
              progMapErr?.message ??
              "Intenta de nuevo en unos minutos."}
          </p>
        </div>
      </section>
    );
  }

  const subjects: Subject[] = subjectsData ?? [];

  // Agrupa los laboratorios activos por materia.
  const labsBySubject: LabsBySubject = {};
  for (const row of (mapData ?? []) as unknown as SubjectLabRow[]) {
    const lab = row.laboratories;
    if (!lab || !lab.is_active) continue;
    (labsBySubject[row.subject_id] ??= []).push({ code: lab.code, name: lab.name });
  }
  for (const id of Object.keys(labsBySubject)) {
    labsBySubject[id].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  // Agrupa las materias por carrera. Una materia puede estar en varias
  // (p. ej. Biomédica comparte las de Metales y CIM).
  const programs: Program[] = programsData ?? [];
  const porId = new Map(subjects.map((s) => [s.id, s]));
  const subjectsByProgram: SubjectsByProgram = {};
  for (const row of progMapData ?? []) {
    const s = porId.get(row.subject_id as string);
    if (!s) continue; // materia inactiva
    (subjectsByProgram[row.program_id as string] ??= []).push(s);
  }
  for (const id of Object.keys(subjectsByProgram)) {
    subjectsByProgram[id].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  return (
    <div className="bg-[var(--umng-navy-50)]">
      {/* Héroe compacto */}
      <section className="hero-umng">
        <div className="mx-auto max-w-3xl px-5 py-10 text-center">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-[var(--umng-gold)]">
            Práctica de laboratorio
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
            Reserva tu cupo en tres pasos
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/80">
            Sin crear cuenta. Ingresa tus datos, elige tu materia y selecciona el
            horario disponible que publicó el laboratorio.
          </p>
        </div>
      </section>

      {/* Wizard */}
      <section className="mx-auto max-w-3xl px-5 pb-20 -mt-6">
        <ReservaWizard
          programs={programs}
          subjectsByProgram={subjectsByProgram}
          labsBySubject={labsBySubject}
        />
      </section>
    </div>
  );
}
