// components/panel/decision-buttons.tsx — Aprobar/Rechazar una solicitud (client)
"use client";

import { useState, useTransition } from "react";
import { decideReservation } from "@/app/(laboratorista)/panel/actions";

export function DecisionButtons({ reservationId }: { reservationId: string }) {
  const [pending, startTransition] = useTransition();
  const [modo, setModo] = useState<"idle" | "rechazando">("idle");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<"aprobada" | "rechazada" | null>(null);

  function decidir(aprueba: boolean, razon?: string) {
    setError(null);
    startTransition(async () => {
      const res = await decideReservation(reservationId, aprueba, razon);
      if (res.ok) setResultado(res.approved ? "aprobada" : "rechazada");
      else setError(res.error);
    });
  }

  if (resultado) {
    return (
      <span
        className={`badge ${
          resultado === "aprobada" ? "badge-aprobada" : "badge-rechazada"
        }`}
      >
        {resultado === "aprobada" ? "Aprobada" : "Rechazada"}
      </span>
    );
  }

  if (modo === "rechazando") {
    return (
      <div className="flex w-full max-w-xs flex-col gap-2">
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo del rechazo (opcional)"
          rows={2}
          className="w-full rounded-lg border p-2 text-sm"
        />
        <div className="flex gap-2">
          <button
            onClick={() => decidir(false, motivo)}
            disabled={pending}
            className="btn-primary text-sm"
          >
            {pending ? "Rechazando…" : "Confirmar rechazo"}
          </button>
          <button
            onClick={() => {
              setModo("idle");
              setMotivo("");
            }}
            disabled={pending}
            className="btn-secondary text-sm"
          >
            Cancelar
          </button>
        </div>
        {error ? <span className="text-xs text-crimson">{error}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          onClick={() => decidir(true)}
          disabled={pending}
          style={{ backgroundColor: "var(--umng-green)" }}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? "…" : "Aprobar"}
        </button>
        <button
          onClick={() => setModo("rechazando")}
          disabled={pending}
          className="btn-secondary text-sm"
        >
          Rechazar
        </button>
      </div>
      {error ? <span className="text-xs text-crimson">{error}</span> : null}
    </div>
  );
}
