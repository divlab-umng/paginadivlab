// app/(laboratorista)/panel/qr/[lab]/page.tsx
// Cartel imprimible con el QR de entrada inmediata del laboratorio.
//
// PENSADO PARA SALIR DE LA IMPRESORA Y PEGARSE EN LA PUERTA
//   Abrir, Ctrl+P, listo. Sin diseñar nada ni pasar por un generador externo.
//   Los estilos de impresión ocultan la cabecera, los botones y todo lo que no
//   sea el cartel, para que no se desperdicie tinta ni media hoja.
//
// EL NOMBRE DEL LABORATORIO VA GRANDE, Y NO ES DECORACIÓN
//   Cada QR apunta a `/entrada/<CODE>`. Si el cartel de CIM termina pegado en
//   la puerta de Metales, el estudiante quedaría anunciado en el laboratorio
//   equivocado y nadie lo notaría hasta que falte el cupo. El nombre visible es
//   lo que evita ese error al momento de pegarlo.
//
// Vive bajo /panel, así que el proxy ya exige sesión y rol: el QR en sí no es
// secreto, pero no hay motivo para exponer una vista interna.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { qrSvg } from "@/lib/qr";
import { BotonImprimir } from "@/components/panel/boton-imprimir";

export const dynamic = "force-dynamic";

export default async function CartelQrPage({
  params,
}: {
  params: Promise<{ lab: string }>;
}) {
  const { lab } = await params;
  const labCode = decodeURIComponent(lab).toUpperCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Solo laboratorios que esta persona administra. `my_admin_labs` ya resuelve
  // el caso del jefe, que los ve todos.
  const { data: labsData } = await supabase.rpc("my_admin_labs");
  const misLabs = (labsData ?? []) as { id: string; code: string; name: string }[];
  const labInfo = misLabs.find((l) => l.code === labCode);
  if (!labInfo) notFound();

  const nombre = labInfo.name.replace(/^LABORATORIO\s+/i, "").trim();

  // `NEXT_PUBLIC_SITE_URL` y no la cabecera de la petición: el QR queda impreso
  // durante meses y debe apuntar al dominio definitivo, no al que se haya usado
  // para abrir el panel ese día.
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const url = `${base}/entrada/${labInfo.code}`;
  const svg = qrSvg(url, { margen: 4 });

  return (
    <>
      <style>{`
        @media print {
          .no-imprimir { display: none !important; }
          .cartel { border: none !important; box-shadow: none !important; }
          @page { margin: 12mm; }
        }
      `}</style>

      <main className="mx-auto max-w-2xl px-5 py-8">
        <div className="no-imprimir mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/panel"
            className="text-sm text-[var(--umng-navy)] hover:underline"
          >
            ← Volver al panel
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
              download={`qr-entrada-${labInfo.code}.svg`}
              className="rounded-lg border border-[var(--umng-navy)] px-4 py-2 text-sm font-semibold text-[var(--umng-navy)] transition hover:bg-[var(--umng-navy)] hover:text-white"
            >
              Descargar SVG
            </a>
            <BotonImprimir />
          </div>
        </div>

        <p className="no-imprimir mb-6 rounded-lg border border-[var(--umng-gold)] bg-amber-50/60 p-3 text-xs text-[var(--umng-ink)]">
          Imprime este cartel y pégalo en la puerta de{" "}
          <strong>{nombre}</strong>. Cada laboratorio tiene su propio código: si
          pegas este en otra puerta, los estudiantes quedarán anunciados en el
          laboratorio equivocado.
        </p>

        {/* El cartel */}
        <div className="cartel rounded-2xl border border-gray-200 bg-white px-8 py-10 text-center">
          <p className="font-data text-xs uppercase tracking-[0.25em] text-[var(--umng-gold)]">
            Universidad Militar Nueva Granada
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold text-[var(--umng-navy)]">
            {nombre}
          </h1>
          <p className="mt-4 text-lg font-semibold text-[var(--umng-ink)]">
            ¿Llegaste sin reserva?
          </p>
          <p className="mt-1 text-base text-[var(--umng-ink)]/75">
            Escanea este código con la cámara de tu celular
          </p>

          <div
            className="mx-auto mt-6 w-full max-w-[19rem]"
            dangerouslySetInnerHTML={{ __html: svg }}
          />

          <p className="mt-6 text-base text-[var(--umng-ink)]">
            Escribe tus datos y luego{" "}
            <strong>muéstrale el carné al laboratorista</strong> para confirmar
            tu ingreso.
          </p>

          <p className="mt-5 font-data text-xs text-[var(--umng-ink)]/50">
            {url}
          </p>
        </div>
      </main>
    </>
  );
}
