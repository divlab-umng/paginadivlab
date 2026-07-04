// components/reservas/reservation-list.tsx — Lista de reservas del estudiante
import Link from "next/link";
import { CancelButton } from "@/components/reservas/cancel-button";
import type { ReservationRow } from "@/app/(estudiante)/mis-reservas/page";
import type { CancelResult } from "@/app/(estudiante)/mis-reservas/actions";

const BADGE: Record<ReservationRow["status"], { clase: string; texto: string }> = {
  pendiente: { clase: "badge-pendiente", texto: "Pendiente" },
  aprobada: { clase: "badge-aprobada", texto: "Aprobada" },
  rechazada: { clase: "badge-rechazada", texto: "Rechazada" },
  cancelada: { clase: "badge-cancelada", texto: "Cancelada" },
};

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

function Fila({
  r,
  cancelar,
}: {
  r: ReservationRow;
  cancelar: (id: string) => Promise<CancelResult>;
}) {
  const badge = BADGE[r.status];
  const cancelable = r.status === "pendiente" || r.status === "aprobada";

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`badge ${badge.clase}`}>{badge.texto}</span>
          <p className="font-data text-xs uppercase tracking-wider text-muted">
            {r.lab_code}
          </p>
        </div>
        <h3 className="mt-1 truncate text-base text-ink">{tituloLimpio(r.lab_name)}</h3>
        <p className="mt-0.5 text-sm text-muted">
          {fechaLarga(r.session_date)} · <span className="font-data">{hhmm(r.start_time)}–{hhmm(r.end_time)}</span>
        </p>
        {r.status === "rechazada" && r.decision_reason ? (
          <p className="mt-1 text-xs text-crimson">Motivo: {r.decision_reason}</p>
        ) : null}
      </div>
      {cancelable ? <CancelButton reservationId={r.id} cancelar={cancelar} /> : null}
    </li>
  );
}

export function ReservationList({
  reservas,
  cancelar,
}: {
  reservas: ReservationRow[];
  cancelar: (id: string) => Promise<CancelResult>;
}) {
  if (reservas.length === 0) {
    return (
      <p className="rounded-lg bg-surface p-6 text-muted">
        Aún no tienes reservas. Ve a{" "}
        <Link href="/laboratorios" className="text-crimson underline">
          Laboratorios
        </Link>{" "}
        para solicitar una práctica.
      </p>
    );
  }

  const ahora = new Date();
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
  const proximas = reservas.filter((r) => r.session_date >= hoy);
  const pasadas = reservas.filter((r) => r.session_date < hoy);

  return (
    <div className="space-y-8">
      {proximas.length > 0 && (
        <section>
          <h2 className="mb-3 font-data text-sm uppercase tracking-wider text-muted">
            Próximas
          </h2>
          <ul className="divide-y rounded-xl border bg-white">
            {proximas.map((r) => (
              <Fila key={r.id} r={r} cancelar={cancelar} />
            ))}
          </ul>
        </section>
      )}

      {pasadas.length > 0 && (
        <section>
          <h2 className="mb-3 font-data text-sm uppercase tracking-wider text-muted">
            Pasadas
          </h2>
          <ul className="divide-y rounded-xl border bg-white opacity-75">
            {pasadas.map((r) => (
              <Fila key={r.id} r={r} cancelar={cancelar} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
