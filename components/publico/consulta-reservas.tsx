// components/publico/consulta-reservas.tsx
// Consulta y cancelación de reservas sin cuenta: código de carné + correo.
"use client";

import { useState, useTransition } from "react";
import {
  consultarReservas,
  cancelarReserva,
  cancelarGrupo,
  type ReservaConsulta,
} from "@/app/(publico)/consulta/actions";

const ESTADO_BADGE: Record<ReservaConsulta["status"], string> = {
  pendiente: "badge-pendiente",
  aprobada: "badge-aprobada",
  rechazada: "badge-rechazada",
  cancelada: "badge-cancelada",
};

const ESTADO_TEXTO: Record<ReservaConsulta["status"], string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
};

function fechaLarga(iso: string) {
  const d = new Date(iso + "T00:00:00"); // hora local: evita corrimiento de día
  const s = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const hhmm = (t: string) => t.slice(0, 5);
const tituloLimpio = (n: string) => n.replace(/^LABORATORIO\s+/i, "");

/** Una sesión es futura si aún no ha empezado (comparación en hora local). */
function esFutura(fecha: string, hora: string) {
  return new Date(`${fecha}T${hora}`) > new Date();
}

export function ConsultaReservas() {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [reservas, setReservas] = useState<ReservaConsulta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, startBusqueda] = useTransition();

  function buscar() {
    setError(null);
    startBusqueda(async () => {
      const res = await consultarReservas(code, email);
      if (res.ok) setReservas(res.reservas);
      else {
        setError(res.error);
        setReservas(null);
      }
    });
  }

  function alCancelar(id: string) {
    setReservas((prev) =>
      (prev ?? []).map((r) =>
        r.reservation_id === id ? { ...r, status: "cancelada" } : r
      )
    );
  }

  /** Al cancelar el grupo, se marcan todas las reservas de ese group_id. */
  function alCancelarGrupo(groupId: string) {
    setReservas((prev) =>
      (prev ?? []).map((r) =>
        r.group_id === groupId && (r.status === "pendiente" || r.status === "aprobada")
          ? { ...r, status: "cancelada" }
          : r
      )
    );
  }

  return (
    <div className="card-elevated overflow-hidden">
      <div className="px-5 py-6 sm:px-8">
        <h2 className="text-lg">Consulta tus reservas</h2>
        <p className="mt-1 text-sm text-[var(--umng-muted)]">
          Ingresa el código de tu carné y el correo con el que reservaste.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
          className="mt-5 space-y-4"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--umng-ink)]">
              Código de estudiante
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Ej. 1801234"
              className="field-lg font-data"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--umng-ink)]">
              Correo institucional
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              placeholder="usuario@unimilitar.edu.co"
              className="field-lg"
              required
            />
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-[var(--umng-crimson)]/30 bg-[var(--umng-crimson)]/5 px-3 py-2 text-sm text-[var(--umng-crimson)]"
            >
              {error}
            </p>
          )}

          <button type="submit" disabled={buscando} className="btn-primary w-full">
            {buscando ? "Buscando…" : "Buscar mis reservas"}
          </button>
        </form>
      </div>

      {reservas && (
        <div className="border-t border-[var(--umng-border)] px-5 py-6 sm:px-8">
          {reservas.length === 0 ? (
            <p className="rounded-lg bg-[var(--umng-surface)] p-4 text-sm text-[var(--umng-muted)]">
              No encontramos reservas con esos datos. Verifica que el código y el
              correo sean los mismos que usaste al reservar.
            </p>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-[var(--umng-navy)]">
                {reservas.length}{" "}
                {reservas.length === 1 ? "reserva encontrada" : "reservas encontradas"}
              </h3>
              <ul className="mt-3 space-y-3">
                {reservas.map((r) => (
                  <FilaReserva
                    key={r.reservation_id}
                    reserva={r}
                    code={code}
                    email={email}
                    onCancelada={() => alCancelar(r.reservation_id)}
                    onGrupoCancelado={() =>
                      r.group_id && alCancelarGrupo(r.group_id)
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilaReserva({
  reserva,
  code,
  email,
  onCancelada,
  onGrupoCancelado,
}: {
  reserva: ReservaConsulta;
  code: string;
  email: string;
  onCancelada: () => void;
  onGrupoCancelado: () => void;
}) {
  // null = sin confirmar | 'mia' = solo mi cupo | 'grupo' = todo el grupo
  const [confirmando, setConfirmando] = useState<null | "mia" | "grupo">(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Solo se cancela lo que sigue activo y aún no ha ocurrido.
  const cancelable =
    (reserva.status === "pendiente" || reserva.status === "aprobada") &&
    esFutura(reserva.session_date, reserva.start_time);

  const enGrupo = reserva.group_id !== null;

  function cancelar() {
    setError(null);
    startTransition(async () => {
      const res = await cancelarReserva(reserva.reservation_id, code, email);
      if (res.ok) onCancelada();
      else setError(res.error);
      setConfirmando(null);
    });
  }

  function cancelarTodoElGrupo() {
    setError(null);
    startTransition(async () => {
      const res = await cancelarGrupo(reserva.reservation_id, code, email);
      if (res.ok) onGrupoCancelado();
      else setError(res.error);
      setConfirmando(null);
    });
  }

  return (
    <li className="rounded-xl border border-[var(--umng-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-data text-xs uppercase tracking-wider text-[var(--umng-muted)]">
              {reserva.lab_code}
            </span>
            <span className={`badge ${ESTADO_BADGE[reserva.status]}`}>
              {ESTADO_TEXTO[reserva.status]}
            </span>
            {enGrupo && (
              <span
                className="badge"
                style={{
                  background: "var(--umng-sky-50)",
                  color: "var(--umng-sky-600)",
                }}
              >
                Grupo de {reserva.integrantes}
                {reserva.es_lider ? " · creaste el grupo" : ""}
              </span>
            )}
          </div>
          <p className="mt-1 font-medium text-[var(--umng-ink)]">
            {tituloLimpio(reserva.lab_name)}
          </p>
          <p className="mt-0.5 text-sm text-[var(--umng-muted)]">
            {fechaLarga(reserva.session_date)} ·{" "}
            <span className="font-data">
              {hhmm(reserva.start_time)}–{hhmm(reserva.end_time)}
            </span>
          </p>
          {reserva.subject_name && (
            <p className="mt-0.5 text-xs text-[var(--umng-muted)]">
              {reserva.subject_name}
            </p>
          )}
        </div>

        {cancelable && (
          <div className="shrink-0">
            {confirmando ? (
              <div className="flex flex-col items-end gap-1.5">
                <p className="text-xs text-[var(--umng-muted)]">
                  {confirmando === "grupo"
                    ? `Se cancelarán las ${reserva.integrantes} reservas del grupo.`
                    : enGrupo
                    ? "Tus compañeros conservarán su reserva."
                    : "Esta acción libera tu cupo."}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={confirmando === "grupo" ? cancelarTodoElGrupo : cancelar}
                    disabled={pending}
                    className="rounded-lg bg-[var(--umng-crimson)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {pending ? "Cancelando…" : "Sí, cancelar"}
                  </button>
                  <button
                    onClick={() => setConfirmando(null)}
                    disabled={pending}
                    className="text-sm text-[var(--umng-muted)] hover:underline"
                  >
                    No
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-1.5">
                <button
                  onClick={() => setConfirmando("mia")}
                  className="btn-secondary text-sm"
                >
                  {enGrupo ? "Cancelar mi cupo" : "Cancelar"}
                </button>
                {/* Cancelar el grupo completo solo lo puede quien lo creó */}
                {enGrupo && reserva.es_lider && (
                  <button
                    onClick={() => setConfirmando("grupo")}
                    className="text-xs font-semibold text-[var(--umng-crimson)] hover:underline"
                  >
                    Cancelar todo el grupo
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--umng-crimson)]">
          {error}
        </p>
      )}
    </li>
  );
}
