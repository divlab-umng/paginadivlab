// components/labs/request-button.tsx — Botón "Solicitar" (client, dispara la Server Action)
"use client";

import { useState, useTransition } from "react";
import type { RequestResult } from "@/app/(estudiante)/laboratorios/actions";

export function RequestButton({
  sessionId,
  solicitar,
  yaReservada,
  sinCupo,
}: {
  sessionId: string;
  solicitar: (sessionId: string) => Promise<RequestResult>;
  yaReservada?: boolean;
  sinCupo?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [solicitada, setSolicitada] = useState(false);

  if (yaReservada || solicitada) {
    return <span className="badge badge-pendiente">Solicitada</span>;
  }
  if (sinCupo) {
    return <span className="badge badge-cancelada">Sin cupo</span>;
  }

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await solicitar(sessionId);
      if (res.ok) setSolicitada(true);
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={onClick} disabled={pending} className="btn-primary text-sm">
        {pending ? "Solicitando…" : "Solicitar"}
      </button>
      {error ? (
        <span className="max-w-[14rem] text-right text-xs text-crimson">{error}</span>
      ) : null}
    </div>
  );
}
