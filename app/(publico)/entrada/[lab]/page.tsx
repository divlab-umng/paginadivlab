// app/(publico)/entrada/[lab]/page.tsx
// Destino del código QR pegado en la puerta del laboratorio.
//
// SIN TOKEN, A PROPÓSITO
//   La URL lleva el código del laboratorio y nada más. Un token en un QR es un
//   identificador al portador: basta fotografiarlo y compartirlo para que
//   cualquiera lo use desde fuera. Y no hace falta, porque esta página NO marca
//   asistencia: solo deja una solicitud pendiente que el laboratorista confirma
//   en persona con el carné. El peor abuso posible es ruido en una lista, el
//   mismo riesgo que ya se acepta en /reservar.
//
// Se lee del catálogo público (`laboratories`, `subject_labs`, `programs`), que
// ya tiene GRANT a `anon` desde las migraciones 0009 y 0019. Ningún permiso
// nuevo.
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EntradaForm } from "@/components/publico/entrada-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Entrada inmediata · UMNG",
  description:
    "Anúnciate al llegar a un laboratorio de la Universidad Militar Nueva Granada sin reserva previa.",
};

export default async function EntradaPage({
  params,
}: {
  params: Promise<{ lab: string }>;
}) {
  const { lab } = await params;
  const labCode = decodeURIComponent(lab).toUpperCase();

  const supabase = await createClient();

  const { data: labData } = await supabase
    .from("laboratories")
    .select("id, code, name")
    .eq("code", labCode)
    .eq("is_active", true)
    .maybeSingle();

  if (!labData) notFound();

  const { data: slData } = await supabase
    .from("subject_labs")
    .select("subjects!inner ( id, name, is_active )")
    .eq("lab_id", labData.id);

  const materias = (slData ?? [])
    .map((row) => row.subjects as unknown as { id: string; name: string; is_active: boolean })
    .filter((s) => s?.is_active)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const { data: carrerasData } = await supabase
    .from("programs")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const nombreLimpio = labData.name.replace(/^LABORATORIO\s+/i, "").trim();

  return (
    <div className="bg-[var(--umng-navy-50)]">
      <section className="hero-umng">
        <div className="mx-auto max-w-lg px-5 py-8">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-[var(--umng-gold)]">
            Entrada inmediata
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{nombreLimpio}</h1>
          <p className="mt-2 text-sm text-white/80">
            ¿Llegaste sin reserva? Escribe tus datos aquí y luego muéstrale el
            carné al laboratorista para confirmar tu ingreso.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-lg px-5 pb-16 -mt-4">
        <EntradaForm
          labCode={labData.code}
          labName={nombreLimpio}
          materias={materias}
          carreras={(carrerasData ?? []) as { id: string; name: string }[]}
        />

        <p className="mt-6 text-center text-xs text-[var(--umng-ink)]/55">
          ¿Vas a venir otro día? Es mejor{" "}
          <a href="/reservar" className="font-semibold text-[var(--umng-navy)] underline">
            reservar con anticipación
          </a>{" "}
          y asegurar tu cupo.
        </p>
      </main>
    </div>
  );
}
