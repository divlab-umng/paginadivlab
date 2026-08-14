// components/panel/request-inbox.tsx — Lista de solicitudes pendientes (laboratorista)
//
// Las solicitudes de un mismo grupo de trabajo se muestran JUNTAS, pero la
// decisión sigue siendo INDIVIDUAL por estudiante: así el laboratorista puede
// rechazar a uno (p. ej. le falta la inducción de seguridad) sin tumbar la
// práctica de sus compañeros.
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

/** Clave de agrupación: el grupo, o la solicitud suelta si es individual. */
type Bloque = {
  clave: string;
  esGrupo: boolean;
  solicitudes: SolicitudRow[];
};

function agrupar(solicitudes: SolicitudRow[]): Bloque[] {
  const bloques: Bloque[] = [];
  const indice = new Map<string, Bloque>();

  for (const s of solicitudes) {
    // Un grupo puede pedir varias franjas: se separa por grupo Y por sesión,
    // porque cada franja se decide aparte.
    const clave = s.group_id
      ? `g:${s.group_id}:${s.session_date}:${s.start_time}`
      : `i:${s.id}`;

    let b = indice.get(clave);
    if (!b) {
      b = { clave, esGrupo: Boolean(s.group_id), solicitudes: [] };
      indice.set(clave, b);
      bloques.push(b);
    }
    b.solicitudes.push(s);
  }

  // Dentro del grupo, primero quien lo creó.
  for (const b of bloques) {
    b.solicitudes.sort((a, c) => Number(c.is_group_leader) - Number(a.is_group_leader));
  }
  return bloques;
}

export function RequestInbox({ solicitudes }: { solicitudes: SolicitudRow[] }) {
  if (solicitudes.length === 0) {
    return (
      <p className="rounded-lg bg-surface p-6 text-muted">
        No hay solicitudes pendientes por revisar.
      </p>
    );
  }

  const bloques = agrupar(solicitudes);
  const grupos = bloques.filter((b) => b.esGrupo).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {solicitudes.length}{" "}
        {solicitudes.length === 1
          ? "solicitud pendiente"
          : "solicitudes pendientes"}
        {grupos > 0
          ? ` · ${grupos} ${grupos === 1 ? "grupo de trabajo" : "grupos de trabajo"}`
          : ""}
        . De la más antigua a la más reciente.
      </p>

      <ul className="space-y-3">
        {bloques.map((b) => {
          const cab = b.solicitudes[0];
          return (
            <li key={b.clave} className="rounded-xl border bg-white p-5">
              {/* Cabecera común: laboratorio y franja */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-data text-xs uppercase tracking-wider text-muted">
                      {cab.lab_code}
                    </p>
                    {b.esGrupo && (
                      <span
                        className="badge"
                        style={{
                          background: "var(--umng-sky-50)",
                          color: "var(--umng-sky-600)",
                        }}
                      >
                        Grupo de {b.solicitudes.length} · 1 puesto
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-lg leading-snug">
                    {tituloLimpio(cab.lab_name)}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {fechaLarga(cab.session_date)} ·{" "}
                    <span className="font-data">
                      {hhmm(cab.start_time)}–{hhmm(cab.end_time)}
                    </span>
                  </p>
                </div>

                {/* Individual: el botón va arriba, como siempre */}
                {!b.esGrupo && <DecisionButtons reservationId={cab.id} />}
              </div>

              {/* Individual: los datos del solicitante */}
              {!b.esGrupo ? (
                <div className="mt-2">
                  <p className="text-sm text-ink">
                    {cab.student_name ? (
                      <>
                        {cab.student_name}{" "}
                        <span className="text-muted">({cab.student_email})</span>
                      </>
                    ) : (
                      cab.student_email
                    )}
                  </p>
                  {cab.student_code ? (
                    <p className="mt-1 font-data text-xs text-muted">
                      Código {cab.student_code}
                    </p>
                  ) : null}
                </div>
              ) : (
                /* Grupo: un renglón por integrante, cada uno con su decisión */
                <ul className="mt-3 divide-y border-t pt-1">
                  {b.solicitudes.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-ink">
                          {s.student_name ?? s.student_email}
                          {s.is_group_leader && (
                            <span className="ml-2 text-xs font-semibold text-[var(--umng-sky-600)]">
                              creó el grupo
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {s.student_email}
                          {s.student_code ? (
                            <span className="font-data"> · {s.student_code}</span>
                          ) : null}
                        </p>
                      </div>
                      <DecisionButtons reservationId={s.id} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
