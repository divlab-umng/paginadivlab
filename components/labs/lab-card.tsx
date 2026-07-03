// components/labs/lab-card.tsx — Tarjeta de laboratorio (lista del estudiante)
import Link from "next/link";

// Quita el prefijo "LABORATORIO " para un título más limpio en la tarjeta.
function tituloLimpio(name: string) {
  return name.replace(/^LABORATORIO\s+/i, "");
}

export function LabCard({
  code,
  name,
  disponibles,
}: {
  code: string;
  name: string;
  disponibles: number;
}) {
  const hayCupo = disponibles > 0;

  return (
    <Link
      href={`/laboratorios/${code}`}
      className="group flex h-full flex-col justify-between rounded-xl border bg-white p-5 transition hover:border-navy hover:shadow-md"
    >
      <div>
        <p className="font-data text-xs uppercase tracking-wider text-muted">
          {code}
        </p>
        <h2 className="mt-2 text-lg leading-snug">{tituloLimpio(name)}</h2>
      </div>

      <div className="mt-4">
        {hayCupo ? (
          <span className="badge badge-aprobada">
            {disponibles} {disponibles === 1 ? "bloque" : "bloques"} con cupo
          </span>
        ) : (
          <span className="badge badge-cancelada">Sin cupos próximos</span>
        )}
      </div>
    </Link>
  );
}
