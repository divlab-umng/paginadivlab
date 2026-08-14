// components/dashboard/staff-manager.tsx
// Gestión de cuentas del personal: aprobar solicitudes, asignar rol y marcar
// los laboratorios de cada laboratorista.
"use client";

import { useState, useTransition } from "react";
import {
  cambiarRol,
  asignarLaboratorios,
  type StaffRow,
  type LabOption,
} from "@/app/(jefe)/dashboard/personal/actions";

const ROL_TEXTO: Record<StaffRow["role"], string> = {
  estudiante: "Sin acceso",
  laboratorista: "Laboratorista",
  jefe: "Jefe",
};

function fechaCorta(iso: string) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function StaffManager({
  personal,
  laboratorios,
  miId,
}: {
  personal: StaffRow[];
  laboratorios: LabOption[];
  miId: string;
}) {
  // Pendiente = pidió acceso y todavía no tiene rol de personal.
  const pendientes = personal.filter(
    (p) => p.role === "estudiante" && p.staff_requested_at !== null
  );
  const activos = personal.filter((p) => p.role !== "estudiante");
  const otros = personal.filter(
    (p) => p.role === "estudiante" && p.staff_requested_at === null
  );

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-[var(--umng-navy)]">
          Solicitudes pendientes
        </h2>
        <p className="mb-3 text-sm text-[var(--umng-ink)]/60">
          Cuentas creadas desde el registro de personal. No tienen acceso a nada
          hasta que les asignes un rol.
        </p>
        {pendientes.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-[var(--umng-ink)]/60">
            No hay solicitudes por revisar.
          </p>
        ) : (
          <ul className="space-y-3">
            {pendientes.map((p) => (
              <FilaPersonal
                key={p.user_id}
                persona={p}
                laboratorios={laboratorios}
                esYo={p.user_id === miId}
                destacar
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-[var(--umng-navy)]">
          Personal activo
        </h2>
        <p className="mb-3 text-sm text-[var(--umng-ink)]/60">
          Un laboratorista solo ve las solicitudes y la asistencia de los
          laboratorios que tenga marcados.
        </p>
        {activos.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-[var(--umng-ink)]/60">
            Todavía no hay personal habilitado.
          </p>
        ) : (
          <ul className="space-y-3">
            {activos.map((p) => (
              <FilaPersonal
                key={p.user_id}
                persona={p}
                laboratorios={laboratorios}
                esYo={p.user_id === miId}
              />
            ))}
          </ul>
        )}
      </section>

      {otros.length > 0 && (
        <section>
          <h2 className="mb-1 font-display text-lg font-semibold text-[var(--umng-navy)]">
            Cuentas antiguas sin acceso
          </h2>
          <p className="mb-3 text-sm text-[var(--umng-ink)]/60">
            Perfiles de estudiante creados antes del rediseño. Los estudiantes ya
            no necesitan cuenta; se conservan por historial.
          </p>
          <ul className="space-y-3">
            {otros.map((p) => (
              <FilaPersonal
                key={p.user_id}
                persona={p}
                laboratorios={laboratorios}
                esYo={p.user_id === miId}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function FilaPersonal({
  persona,
  laboratorios,
  esYo,
  destacar,
}: {
  persona: StaffRow;
  laboratorios: LabOption[];
  esYo: boolean;
  destacar?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState<string[]>(persona.lab_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accionRol(role: StaffRow["role"]) {
    setError(null);
    startTransition(async () => {
      const res = await cambiarRol(persona.user_id, role);
      if (!res.ok) setError(res.error);
    });
  }

  function guardarLabs() {
    setError(null);
    startTransition(async () => {
      const res = await asignarLaboratorios(persona.user_id, seleccion);
      if (res.ok) setAbierto(false);
      else setError(res.error);
    });
  }

  function toggleLab(id: string) {
    setSeleccion((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <li
      className="rounded-xl border bg-white p-5"
      style={destacar ? { borderColor: "var(--umng-gold)" } : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-[var(--umng-ink)]">
              {persona.full_name ?? persona.email}
            </p>
            <span
              className={`badge ${
                persona.role === "jefe"
                  ? "badge-aprobada"
                  : persona.role === "laboratorista"
                  ? "badge-pendiente"
                  : "badge-cancelada"
              }`}
            >
              {ROL_TEXTO[persona.role]}
            </span>
            {esYo && (
              <span className="font-data text-xs text-[var(--umng-ink)]/50">
                (tu cuenta)
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-[var(--umng-ink)]/70">{persona.email}</p>
          <p className="mt-0.5 font-data text-xs text-[var(--umng-ink)]/50">
            {persona.staff_requested_at
              ? `Solicitó acceso el ${fechaCorta(persona.staff_requested_at)}`
              : `Cuenta creada el ${fechaCorta(persona.created_at)}`}
          </p>
          {persona.role === "laboratorista" && (
            <p className="mt-1 text-xs text-[var(--umng-ink)]/70">
              {persona.lab_codes.length > 0 ? (
                <>
                  Administra:{" "}
                  <span className="font-data">{persona.lab_codes.join(", ")}</span>
                </>
              ) : (
                <span style={{ color: "var(--umng-crimson)" }}>
                  Sin laboratorios asignados — todavía no puede hacer nada.
                </span>
              )}
            </p>
          )}
        </div>

        {/* El jefe no puede cambiar su propio rol: se bloquearía a sí mismo */}
        {!esYo && (
          <div className="flex flex-wrap items-center gap-2">
            {persona.role !== "laboratorista" && (
              <button
                onClick={() => accionRol("laboratorista")}
                disabled={pending}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                style={{ backgroundColor: "var(--umng-green)" }}
              >
                Hacer laboratorista
              </button>
            )}
            {persona.role === "laboratorista" && (
              <button
                onClick={() => setAbierto((v) => !v)}
                disabled={pending}
                className="btn-secondary text-sm"
              >
                {abierto ? "Cerrar" : "Laboratorios"}
              </button>
            )}
            {persona.role !== "jefe" && (
              <button
                onClick={() => accionRol("jefe")}
                disabled={pending}
                className="btn-secondary text-sm"
              >
                Hacer jefe
              </button>
            )}
            {persona.role !== "estudiante" && (
              <button
                onClick={() => accionRol("estudiante")}
                disabled={pending}
                className="text-sm font-semibold text-[var(--umng-crimson)] hover:underline disabled:opacity-60"
                title="Quita el rol y sus laboratorios asignados"
              >
                Quitar acceso
              </button>
            )}
          </div>
        )}
      </div>

      {/* Selector de laboratorios */}
      {abierto && persona.role === "laboratorista" && (
        <div className="mt-4 border-t pt-4">
          <p className="mb-2 text-sm font-medium text-[var(--umng-ink)]">
            Laboratorios que administra
          </p>
          <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {laboratorios.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--umng-surface)]"
              >
                <input
                  type="checkbox"
                  checked={seleccion.includes(l.id)}
                  onChange={() => toggleLab(l.id)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[var(--umng-ink)]">
                    {l.name.replace(/^LABORATORIO\s+/i, "")}
                  </span>
                  <span className="block font-data text-xs text-[var(--umng-ink)]/50">
                    {l.code}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={guardarLabs}
              disabled={pending}
              className="btn-primary text-sm"
            >
              {pending ? "Guardando…" : `Guardar (${seleccion.length})`}
            </button>
            <button
              onClick={() => {
                setSeleccion(persona.lab_ids ?? []);
                setAbierto(false);
              }}
              disabled={pending}
              className="text-sm text-[var(--umng-ink)]/60 hover:underline"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--umng-crimson)]">
          {error}
        </p>
      )}
    </li>
  );
}
