// components/panel/attendance-section.tsx — Registro de asistencia por sesión (laboratorista, client)
"use client";

import { useMemo, useState, useTransition } from "react";
import { markAttendance, scanAttendance } from "@/app/(laboratorista)/panel/actions";
import { BarcodeScanner } from "@/components/panel/barcode-scanner";
import type {
  Asistente,
  AsistenciaSesionConAsistentes,
} from "@/app/(laboratorista)/panel/page";

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

// Insignia del estado de la sesión (migración 0013).
function EstadoBadge({ estado }: { estado: AsistenciaSesionConAsistentes["estado"] }) {
  if (estado === "en_curso") {
    return (
      <span
        className="badge"
        style={{ background: "var(--umng-sky-50)", color: "var(--umng-sky-600)" }}
      >
        En curso
      </span>
    );
  }
  if (estado === "por_iniciar") {
    return <span className="badge badge-pendiente">Por iniciar</span>;
  }
  return <span className="badge badge-cancelada">Finalizada</span>;
}

export function AttendanceSection({
  sesiones,
}: {
  sesiones: AsistenciaSesionConAsistentes[];
}) {
  if (sesiones.length === 0) {
    return (
      <p className="rounded-lg bg-surface p-6 text-muted">
        No hay sesiones con asistencia por registrar en este momento.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {sesiones.map((s) => (
        <AttendanceCard key={s.session_id} sesion={s} />
      ))}
    </ul>
  );
}

function AttendanceCard({ sesion }: { sesion: AsistenciaSesionConAsistentes }) {
  const totalMarcadas = sesion.marcadas;
  const totalAprobadas = sesion.aprobadas;
  const yaRegistrada = totalMarcadas >= totalAprobadas && totalAprobadas > 0;

  const [abierto, setAbierto] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  // Estado de presencia por reservación: presente por defecto (attended !== false).
  const [presentes, setPresentes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      sesion.asistentes.map((a) => [a.reservation_id, a.attended !== false])
    )
  );
  // Códigos ya confirmados por escáner (se resaltan en la lista).
  const [escaneados, setEscaneados] = useState<Set<string>>(new Set());

  // El escáner ya persiste en la BD; aquí solo se refleja en pantalla.
  async function manejarCodigo(codigo: string) {
    const res = await scanAttendance(sesion.session_id, codigo);
    if (res.ok) {
      const asistente = sesion.asistentes.find((a) => a.student_code === res.codigo);
      if (asistente) {
        setPresentes((prev) => ({ ...prev, [asistente.reservation_id]: true }));
        setEscaneados((prev) => new Set(prev).add(res.codigo));
      }
    }
    return res;
  }
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{
    presentes: number;
    ausentes: number;
  } | null>(null);

  const conteo = useMemo(() => {
    const pres = sesion.asistentes.filter(
      (a) => presentes[a.reservation_id]
    ).length;
    return { presentes: pres, ausentes: sesion.asistentes.length - pres };
  }, [presentes, sesion.asistentes]);

  function toggle(a: Asistente) {
    setPresentes((prev) => ({
      ...prev,
      [a.reservation_id]: !prev[a.reservation_id],
    }));
  }

  function todosPresentes() {
    setPresentes(
      Object.fromEntries(sesion.asistentes.map((a) => [a.reservation_id, true]))
    );
  }

  function confirmar() {
    setError(null);
    const ausentes = sesion.asistentes
      .filter((a) => !presentes[a.reservation_id])
      .map((a) => a.reservation_id);

    startTransition(async () => {
      const res = await markAttendance(sesion.session_id, ausentes);
      if (res.ok) {
        setHecho({
          presentes: sesion.asistentes.length - ausentes.length,
          ausentes: ausentes.length,
        });
        setAbierto(false);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <li className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-data text-xs uppercase tracking-wider text-muted">
              {sesion.lab_code}
            </p>
            <EstadoBadge estado={sesion.estado} />
          </div>
          <h3 className="mt-1 text-lg leading-snug">
            {tituloLimpio(sesion.lab_name)}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {fechaLarga(sesion.session_date)} ·{" "}
            <span className="font-data">
              {hhmm(sesion.start_time)}–{hhmm(sesion.end_time)}
            </span>
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {hecho ? (
            <span className="badge badge-aprobada">
              Asistencia registrada
            </span>
          ) : (
            <>
              <span className="font-data text-xs text-muted">
                {totalMarcadas} de {totalAprobadas} marcadas
              </span>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => {
                    setEscaneando((v) => !v);
                    setAbierto(true);
                  }}
                  disabled={pending}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                  style={{ backgroundColor: "var(--umng-sky)" }}
                >
                  {escaneando ? "Ocultar escáner" : "Escanear carnés"}
                </button>
                <button
                  onClick={() => setAbierto((v) => !v)}
                  disabled={pending}
                  className="btn-secondary text-sm"
                >
                  {abierto
                    ? "Cerrar"
                    : yaRegistrada
                    ? "Revisar asistencia"
                    : "Registrar asistencia"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {hecho ? (
        <p className="mt-3 text-sm text-ink">
          {hecho.presentes}{" "}
          {hecho.presentes === 1 ? "presente" : "presentes"}
          {hecho.ausentes > 0 ? (
            <>
              {" "}
              ·{" "}
              <span className="text-crimson">
                {hecho.ausentes}{" "}
                {hecho.ausentes === 1 ? "ausente" : "ausentes"}
              </span>
            </>
          ) : null}
          .
        </p>
      ) : null}

      {escaneando && !hecho ? (
        <div className="mt-4">
          <BarcodeScanner
            onCodigo={manejarCodigo}
            onCerrar={() => setEscaneando(false)}
          />
        </div>
      ) : null}

      {abierto && !hecho ? (
        <div className="mt-4 border-t pt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted">
              {conteo.presentes} presentes · {conteo.ausentes} ausentes
            </p>
            <button
              onClick={todosPresentes}
              disabled={pending}
              className="text-sm text-navy underline underline-offset-2 hover:opacity-80"
            >
              Marcar todos presentes
            </button>
          </div>

          <ul className="divide-y">
            {sesion.asistentes.map((a) => {
              const presente = presentes[a.reservation_id];
              return (
                <li
                  key={a.reservation_id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">
                      {a.full_name ?? a.email}
                      {a.student_code && escaneados.has(a.student_code) ? (
                        <span
                          className="ml-2 align-middle text-xs font-semibold"
                          style={{ color: "var(--umng-sky-600)" }}
                          title="Confirmado escaneando el carné"
                        >
                          escaneado
                        </span>
                      ) : null}
                    </p>
                    {a.full_name ? (
                      <p className="truncate text-xs text-muted">{a.email}</p>
                    ) : null}
                    {/* Código del carné: lo que devolverá el escáner (Fase 4) */}
                    {a.student_code ? (
                      <p className="font-data text-xs text-muted">
                        {a.student_code}
                      </p>
                    ) : null}
                  </div>
                  <button
                    onClick={() => toggle(a)}
                    disabled={pending}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
                      presente ? "text-white" : "btn-secondary"
                    }`}
                    style={
                      presente
                        ? { backgroundColor: "var(--umng-green)" }
                        : undefined
                    }
                  >
                    {presente ? "Presente" : "Ausente"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={confirmar}
              disabled={pending}
              style={{ backgroundColor: "var(--umng-green)" }}
              className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {pending ? "Guardando…" : "Confirmar asistencia"}
            </button>
            {error ? (
              <span className="text-xs text-crimson">{error}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
