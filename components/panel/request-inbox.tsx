// components/panel/request-inbox.tsx — Lista de solicitudes pendientes (laboratorista)
import { DecisionButtons } from "@/components/panel/decision-buttons";
import type { SolicitudRow } from "@/app/(laboratorista)/panel/page";

function tituloLimpio(name: string) {
  return name.replace(/^LABORATORIO\s+/i, "");
}

function fechaLarga(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const s = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const hhmm = (t: string) => t.slice(0, 5);

export function RequestInbox({ solicitudes }: { solicitudes: SolicitudRow[] }) {
  if (solicitudes.length === 0) {
    return (
      <p className="rounded-lg bg-surface p-6 text-muted">
        No hay solicitudes pendientes por revisar.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {solicitudes.length}{" "}
        {solicitudes.length === 1
          ? "solicitud pendiente"
          : "solicitudes pendientes"}
        . De la más antigua a la más reciente.
      </p>

      <ul className="space-y-3">
        {solicitudes.map((s) => (
          <li key={s.id} className="rounded-xl border bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-data text-xs uppercase tracking-wider text-muted">
                  {s.lab_code}
                </p>
                <h2 className="mt-1 text-lg leading-snug">
                  {tituloLimpio(s.lab_name)}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {fechaLarga(s.session_date)} ·{" "}
                  <span className="font-data">
                    {hhmm(s.start_time)}–{hhmm(s.end_time)}
                  </span>
                </p>
                <p className="mt-2 text-sm text-ink">
                  {s.student_name ? (
                    <>
                      {s.student_name}{" "}
                      <span className="text-muted">({s.student_email})</span>
                    </>
                  ) : (
                    s.student_email
                  )}
                </p>
              </div>

              <DecisionButtons reservationId={s.id} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
