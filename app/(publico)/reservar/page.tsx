// app/(publico)/reservar/page.tsx — entrada pública del estudiante (sin login).
//
// Server Component. Carga ÚNICAMENTE las carreras y se las entrega al wizard.
//
// POR QUÉ SOLO LAS CARRERAS
//   Antes traía todas las materias y todos los mapeos materia→laboratorio y
//   materia→carrera al abrir la página. Con tres laboratorios eran unas decenas
//   de filas. Camino a los cincuenta previstos serían cientos, viajando al
//   celular de cada estudiante para mostrarle las pocas de su carrera.
//
//   Las carreras son una lista corta que NO crece con los laboratorios: son las
//   que ofrece la universidad. El resto de la cascada lo pide el wizard al
//   elegir una, con `cargarOfertaCarrera`.
import { createClient } from "@/lib/supabase/server";
import { ReservaWizard } from "@/components/publico/reserva-wizard";
import type { Program } from "@/components/publico/reserva-wizard";

export const metadata = {
  title: "Reservar laboratorio · UMNG",
  description:
    "Solicita tu práctica de laboratorio en la Universidad Militar Nueva Granada sin necesidad de crear una cuenta.",
};

export default async function ReservarPage() {
  const supabase = await createClient();

  const { data: programsData, error: progErr } = await supabase
    .from("programs")
    .select("id, code, name")
    .eq("is_active", true)
    .order("name");

  if (progErr) {
    return (
      <section className="mx-auto max-w-2xl px-5 py-16">
        <div className="card-elevated p-6">
          <h1 className="text-xl">No pudimos cargar las carreras</h1>
          <p className="mt-2 text-sm text-[var(--umng-muted)]">
            {progErr.message ?? "Intenta de nuevo en unos minutos."}
          </p>
        </div>
      </section>
    );
  }

  const programs: Program[] = programsData ?? [];

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
        <ReservaWizard programs={programs} />
      </section>
    </div>
  );
}
