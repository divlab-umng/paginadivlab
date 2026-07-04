// components/reservas/cancel-button.tsx — Botón "Cancelar" (client, dispara la Server Action)
"use client";

import { useState, useTransition } from "react";
import type { CancelResult } from "@/app/(estudiante)/mis-reservas/actions";

export function CancelButton({
  reservationId,
  cancelar,
}: {
  reservationId: string;
  cancelar: (id: string) => Promise<CancelResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  function onCancelar() {
    setError(null);
    startTransition(async () => {
      const res = await cancelar(reservationId);
      if (!res.ok) {
        setError(res.error);
        setConfirmando(false);
      }
      // Si sale bien, revalidatePath refresca la lista y esta fila cambia sola.
    });
  }

  if (!confirmando) {
    return (
      <button
        onClick={() => setConfirmando(true)}
        className="btn-secondary text-sm"
      >
        Cancelar
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button onClick={onCancelar} disabled={pending} className="btn-primary text-sm">
          {pending ? "Cancelando…" : "Confirmar"}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={pending}
          className="btn-secondary text-sm"
        >
          No
        </button>
      </div>
      {error ? (
        <span className="max-w-[14rem] text-right text-xs text-crimson">{error}</span>
      ) : null}
    </div>
  );
}
