// components/publico/entrada-form.tsx
// El estudiante se anuncia al llegar sin reserva, desde su propio celular.
//
// DISEÑADO PARA ALGUIEN DE PIE EN LA PUERTA
//   Un solo paso, sin asistente de tres pantallas. Quien usa esto ya está en el
//   laboratorio con la mochila al hombro: cada campo de más es una razón para
//   abandonar y pedirle al laboratorista que lo escriba por él, que es
//   justamente lo que se quería evitar.
//
// LO QUE ESTA PANTALLA NO HACE
//   No marca asistencia. Deja una solicitud anunciada; la presencia la confirma
//   el laboratorista escaneando el carné. Por eso el mensaje final dice
//   "acércate al laboratorista" y no "listo, ya estás dentro".
"use client";

import { useActionState, useState } from "react";
import {
  anunciarEntradaAction,
  type EntradaState,
} from "@/app/(publico)/entrada/[lab]/actions";

const inicial: EntradaState = {};

export type MateriaOpcion = { id: string; name: string };
export type CarreraOpcion = { id: string; name: string };

export function EntradaForm({
  labCode,
  labName,
  materias,
  carreras,
}: {
  labCode: string;
  labName: string;
  materias: MateriaOpcion[];
  carreras: CarreraOpcion[];
}) {
  const [state, formAction, pending] = useActionState(anunciarEntradaAction, inicial);
  const [autoriza, setAutoriza] = useState(false);

  if (state.ok) {
    return (
      <div className="card-elevated px-6 py-8 text-center">
        <p className="font-display text-xl font-semibold text-[var(--umng-green)]">
          {state.yaAnunciado ? "Ya estabas anunciado" : "¡Listo!"}
        </p>
        <p className="mt-3 text-sm text-[var(--umng-ink)]">
          Quedaste anunciado en <strong>{state.labName ?? labName}</strong>
          {state.franja ? ` (${state.franja})` : ""}.
        </p>
        <p className="mt-4 rounded-lg bg-[var(--umng-surface)] p-4 text-sm text-[var(--umng-ink)]">
          <strong>Acércate al laboratorista con tu carné.</strong> Él confirma tu
          ingreso escaneándolo. Tu asistencia queda registrada en ese momento, no
          ahora.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card-elevated space-y-4 px-6 py-6">
      <input type="hidden" name="lab_code" value={labCode} />

      <label className="block">
        <span className="text-sm font-medium text-[var(--umng-ink)]">
          Código de tu carné
        </span>
        <input
          name="student_code"
          inputMode="numeric"
          autoComplete="off"
          required
          placeholder="1234567"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2.5 font-data text-base"
        />
        <span className="mt-1 block text-xs text-[var(--umng-ink)]/55">
          El número del frente, el mismo del código de barras.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-[var(--umng-ink)]">
          Nombre completo
        </span>
        <input
          name="student_name"
          required
          autoComplete="name"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2.5 text-base"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-[var(--umng-ink)]">
          Correo institucional
        </span>
        <input
          name="student_email"
          type="email"
          required
          autoComplete="email"
          placeholder="usuario@unimilitar.edu.co"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2.5 text-base"
        />
      </label>

      {carreras.length > 0 && (
        <label className="block">
          <span className="text-sm font-medium text-[var(--umng-ink)]">
            Carrera <span className="font-normal text-[var(--umng-ink)]/55">(opcional)</span>
          </span>
          <select
            name="program_id"
            defaultValue=""
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2.5 text-base"
          >
            <option value="">— Selecciona —</option>
            {carreras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}

      {materias.length > 0 && (
        <label className="block">
          <span className="text-sm font-medium text-[var(--umng-ink)]">
            Materia <span className="font-normal text-[var(--umng-ink)]/55">(opcional)</span>
          </span>
          <select
            name="subject_id"
            defaultValue=""
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2.5 text-base"
          >
            <option value="">— Selecciona —</option>
            {materias.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--umng-border)] bg-[var(--umng-surface)] p-4">
        <input
          type="checkbox"
          name="autoriza"
          checked={autoriza}
          onChange={(e) => setAutoriza(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span className="text-sm text-[var(--umng-ink)]">
          Autorizo al administrador de la plataforma a tratar mis datos personales
          para gestionar mi práctica de laboratorio y el control de asistencia,
          conforme a la{" "}
          <a
            href="/politica-datos"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--umng-navy)] underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            política de tratamiento de datos
          </a>
          .
        </span>
      </label>

      <button
        type="submit"
        disabled={pending || !autoriza}
        className="btn-primary w-full py-3 text-base disabled:opacity-50"
      >
        {pending ? "Anunciando…" : "Anunciar mi llegada"}
      </button>

      {state.error && (
        <p className="rounded-md border border-[var(--umng-crimson)] bg-red-50 p-3 text-sm text-[var(--umng-ink)]">
          {state.error}
        </p>
      )}
    </form>
  );
}
