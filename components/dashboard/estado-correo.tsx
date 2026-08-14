// components/dashboard/estado-correo.tsx
// Hace visible el estado del envío de correos.
//
// El sistema degrada en silencio a propósito (un fallo de correo nunca debe
// tumbar una reserva), pero silencioso e invisible no es lo mismo: sin este
// aviso, los correos podrían llevar semanas sin salir y nadie lo notaría.
"use client";

import { useState, useTransition } from "react";
import {
  enviarCorreoDePrueba,
  type PruebaCorreoResult,
} from "@/app/(jefe)/dashboard/correo-actions";

export function EstadoCorreo({ configurado }: { configurado: boolean }) {
  const [res, setRes] = useState<PruebaCorreoResult | null>(null);
  const [pending, startTransition] = useTransition();

  function probar() {
    setRes(null);
    startTransition(async () => setRes(await enviarCorreoDePrueba()));
  }

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        borderColor: configurado ? "var(--umng-border)" : "var(--umng-gold)",
        background: configurado ? "#fff" : "color-mix(in srgb, var(--umng-gold) 8%, #fff)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-[var(--umng-navy)]">
            Envío de correos
          </h3>
          {configurado ? (
            <p className="mt-1 text-sm text-[var(--umng-ink)]/70">
              Configurado. Los estudiantes reciben confirmación y decisión; los
              laboratoristas, aviso de solicitudes nuevas.
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--umng-ink)]/80">
              <strong>Sin configurar.</strong> No se está enviando ningún correo:
              los estudiantes no sabrán si les aprobaron sin entrar a consultar, y
              los laboratoristas no reciben aviso de solicitudes nuevas. Falta la
              variable <span className="font-data">RESEND_API_KEY</span>.
            </p>
          )}
        </div>

        <button
          onClick={probar}
          disabled={pending}
          className="btn-secondary shrink-0 text-sm disabled:opacity-60"
        >
          {pending ? "Enviando…" : "Enviar prueba"}
        </button>
      </div>

      {res && (
        <div className="mt-3 rounded-lg px-3 py-2 text-sm"
          style={{
            background: res.ok
              ? "color-mix(in srgb, var(--umng-green) 10%, #fff)"
              : "color-mix(in srgb, var(--umng-crimson) 8%, #fff)",
          }}
        >
          {res.ok ? (
            <>
              <p className="font-semibold text-[var(--umng-ink)]">
                Correo enviado a {res.destino}
              </p>
              <p className="mt-0.5 font-data text-xs text-[var(--umng-ink)]/60">
                Remitente: {res.remitente}
              </p>
              <p className="mt-1 text-xs text-[var(--umng-ink)]/70">
                Si no llega en unos minutos, revisa la carpeta de correo no deseado.
              </p>
            </>
          ) : (
            <p className="text-[var(--umng-crimson)]">{res.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
