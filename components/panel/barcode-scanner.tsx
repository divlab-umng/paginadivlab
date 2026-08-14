// components/panel/barcode-scanner.tsx
// Escáner del carné estudiantil con la cámara del celular (Fase 4).
//
// El carné UMNG usa CODE 39 y contiene el código estudiantil. El lector se
// restringe SOLO a ese formato: es más rápido y evita falsos positivos con
// otros códigos que puedan aparecer en cámara.
//
// REQUISITO DEL NAVEGADOR: la cámara exige contexto seguro (HTTPS o localhost).
// Si se abre por IP de red local sin HTTPS, el navegador bloquea getUserMedia;
// el componente lo detecta y ofrece la entrada manual como respaldo.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import type { IScannerControls } from "@zxing/browser/esm/common/IScannerControls";

export type ResultadoEscaneo = {
  ok: boolean;
  motivo: "marcado" | "ya_marcado" | "sin_reserva" | "error";
  nombre?: string | null;
  codigo: string;
  mensaje?: string;
};

// Evita releer el mismo carné mil veces: ZXing dispara de forma continua.
const MS_ANTIRREBOTE = 2500;

export function BarcodeScanner({
  onCodigo,
  onCerrar,
}: {
  onCodigo: (codigo: string) => Promise<ResultadoEscaneo>;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const ultimoRef = useRef<{ codigo: string; t: number }>({ codigo: "", t: 0 });
  const procesandoRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<ResultadoEscaneo | null>(null);
  const [manual, setManual] = useState("");
  const [iniciando, setIniciando] = useState(true);

  // Realimentación: pitido corto + vibración. Distinto tono según el resultado.
  const beep = useCallback((exito: boolean) => {
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = exito ? 880 : 240;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
      setTimeout(() => void ctx.close(), 300);
    } catch {
      /* sin audio disponible: no pasa nada */
    }
    try {
      navigator.vibrate?.(exito ? 60 : [60, 60, 60]);
    } catch {
      /* sin vibración: no pasa nada */
    }
  }, []);

  const procesar = useCallback(
    async (codigoCrudo: string) => {
      const codigo = codigoCrudo.replace(/\D/g, ""); // Code 39 puede traer '*'
      if (!codigo || procesandoRef.current) return;

      const ahora = Date.now();
      if (
        ultimoRef.current.codigo === codigo &&
        ahora - ultimoRef.current.t < MS_ANTIRREBOTE
      ) {
        return; // mismo carné, aún dentro del antirrebote
      }
      ultimoRef.current = { codigo, t: ahora };

      procesandoRef.current = true;
      try {
        const res = await onCodigo(codigo);
        setUltimo(res);
        beep(res.ok && res.motivo === "marcado");
      } finally {
        procesandoRef.current = false;
      }
    },
    [onCodigo, beep]
  );

  useEffect(() => {
    let cancelado = false;

    async function iniciar() {
      // Contexto seguro: sin esto el navegador ni siquiera expone la cámara.
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        setError(
          "La cámara requiere una conexión segura (HTTPS). Estás en una dirección sin HTTPS, " +
            "así que usa la entrada manual mientras tanto."
        );
        setIniciando(false);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Este navegador no permite acceder a la cámara.");
        setIniciando(false);
        return;
      }

      try {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints);

        // Cámara trasera: es la que apunta al carné.
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (result) void procesar(result.getText());
          }
        );

        if (cancelado) controls.stop();
        else {
          controlsRef.current = controls;
          setIniciando(false);
        }
      } catch (e) {
        const msg = (e as Error).message ?? "";
        setError(
          /permission|denied|notallowed/i.test(msg)
            ? "Permiso de cámara denegado. Habilítalo en el navegador y vuelve a intentar."
            : `No se pudo abrir la cámara: ${msg}`
        );
        setIniciando(false);
      }
    }

    void iniciar();

    // Apagar la cámara al cerrar: si no, el led sigue encendido.
    return () => {
      cancelado = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [procesar]);

  return (
    <div className="rounded-xl border border-[var(--umng-navy-100)] bg-[var(--umng-navy-50)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-[var(--umng-navy)]">
          Escáner de carné
        </h4>
        <button onClick={onCerrar} className="btn-secondary text-sm">
          Cerrar cámara
        </button>
      </div>

      {/* Visor */}
      {!error && (
        <div className="relative mt-3 overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            className="h-56 w-full object-cover"
            muted
            playsInline
          />
          {/* Guía de encuadre */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-20 w-4/5 rounded-md border-2 border-[var(--umng-gold)]/80" />
          </div>
          {iniciando && (
            <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/80">
              Encendiendo cámara…
            </p>
          )}
        </div>
      )}

      {!error && (
        <p className="mt-2 text-xs text-[var(--umng-muted)]">
          Apunta al código de barras del reverso del carné. Se registra solo.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-[var(--umng-crimson)]/30 bg-white px-3 py-2 text-sm text-[var(--umng-crimson)]"
        >
          {error}
        </p>
      )}

      {/* Último resultado */}
      {ultimo && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-sm"
          style={{
            background:
              ultimo.motivo === "marcado"
                ? "color-mix(in srgb, var(--umng-green) 12%, #fff)"
                : ultimo.motivo === "ya_marcado"
                ? "color-mix(in srgb, var(--umng-gold) 18%, #fff)"
                : "color-mix(in srgb, var(--umng-crimson) 10%, #fff)",
          }}
        >
          <p className="font-semibold text-[var(--umng-ink)]">
            {ultimo.motivo === "marcado" && `✓ ${ultimo.nombre ?? "Presente"}`}
            {ultimo.motivo === "ya_marcado" && `Ya registrado: ${ultimo.nombre ?? ""}`}
            {ultimo.motivo === "sin_reserva" && "Sin reserva aprobada en esta práctica"}
            {ultimo.motivo === "error" && (ultimo.mensaje ?? "Error al registrar")}
          </p>
          <p className="font-data text-xs text-[var(--umng-muted)]">{ultimo.codigo}</p>
        </div>
      )}

      {/* Respaldo manual: carné rayado, cámara sin permiso, sin HTTPS… */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) {
            void procesar(manual);
            setManual("");
          }
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="O escribe el código"
          className="field-lg font-data flex-1 bg-white"
        />
        <button type="submit" className="btn-secondary shrink-0 text-sm">
          Registrar
        </button>
      </form>
    </div>
  );
}
