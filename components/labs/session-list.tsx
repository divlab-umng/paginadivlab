// components/labs/session-list.tsx — Sesiones próximas de un lab, agrupadas por día
import { RequestButton } from "@/components/labs/request-button";
import type { RequestResult } from "@/app/(estudiante)/laboratorios/actions";

type Session = {
  id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  reserved_count: number;
};

function fechaLarga(iso: string) {
  const d = new Date(iso + "T00:00:00"); // fuerza hora local (evita corrimiento UTC)
  const s = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const hhmm = (t: string) => t.slice(0, 5);

export function SessionList({
  sessions,
  reservadas,
  solicitar,
}: {
  sessions: Session[];
  reservadas: string[];
  solicitar: (sessionId: string) => Promise<RequestResult>;
}) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-lg bg-surface p-6 text-muted">
        Este laboratorio no tiene bloques disponibles en los próximos 7 días.
      </p>
    );
  }

  const yaReservadas = new Set(reservadas);

  const porFecha = new Map<string, Session[]>();
  for (const s of sessions) {
    const arr = porFecha.get(s.session_date);
    if (arr) arr.push(s);
    else porFecha.set(s.session_date, [s]);
  }

  return (
    <div className="space-y-8">
      {[...porFecha.entries()].map(([fecha, items]) => (
        <section key={fecha}>
          <h3 className="mb-3 font-data text-sm uppercase tracking-wider text-muted">
            {fechaLarga(fecha)}
          </h3>
          <ul className="divide-y rounded-xl border bg-white">
            {items.map((s) => {
              const disponible = s.capacity - s.reserved_count;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <p className="font-data text-base text-ink">
                      {hhmm(s.start_time)} – {hhmm(s.end_time)}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      <span className="font-data">{disponible}</span> de{" "}
                      <span className="font-data">{s.capacity}</span> cupos disponibles
                    </p>
                  </div>
                  <RequestButton
                    sessionId={s.id}
                    solicitar={solicitar}
                    yaReservada={yaReservadas.has(s.id)}
                    sinCupo={disponible <= 0}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
