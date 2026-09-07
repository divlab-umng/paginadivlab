// components/panel/barcode-scanner.tsx
// Escáner del carné estudiantil con la cámara del celular (Fase 4).
//
// POR QUÉ ACEPTA VARIOS FORMATOS Y NO SOLO CODE 39
//   La primera versión se restringía a CODE_39, porque así salió al decodificar
//   una foto del carné. En campo no leía nada. Restringir el formato es una
//   optimización que solo vale si se está seguro del formato, y no lo estamos:
//   un carné puede traer un código distinto en el reverso, y las tandas de
//   plástico cambian con los años. Si el lector no contempla el formato, no
//   falla con un aviso: simplemente no ve nada, que es el peor modo de fallar.
//
//   El coste de aceptar varias simbologías 1D es CPU, no corrección: el
//   contenido se valida después contra `students.student_code`.
//
// RESOLUCIÓN: SE PIDE EXPLÍCITAMENTE
//   Sin `width`/`height` el navegador entrega lo que le parece, normalmente
//   640×480. Un código 1D necesita píxeles horizontales para separar las barras
//   finas; a esa resolución un Code 39 de siete dígitos a 20 cm suele quedar
//   por debajo del umbral decodificable. Es la causa silenciosa más común de
//   "la cámara enciende pero no lee".
//
// MODO DIAGNÓSTICO
//   Muestra el texto crudo y el formato de CUALQUIER código leído, aunque no
//   corresponda a ninguna reserva. Sin esto, depurar un escáner en campo es
//   adivinar: no se distingue "no lee" de "lee algo que no esperábamos".
//
// REQUISITO DEL NAVEGADOR: la cámara exige contexto seguro (HTTPS o localhost).
// Si se abre por IP de red local sin HTTPS, el navegador bloquea getUserMedia;
// el componente lo detecta y ofrece la entrada manual como respaldo.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import type { IScannerControls } from "@zxing/browser/esm/common/IScannerControls";

/**
 * Simbologías 1D que puede traer un carné institucional.
 * CODE_39 va primera porque es la confirmada en el carné UMNG; el resto están
 * por si el reverso —o una tanda distinta de plástico— usa otra cosa.
 */
const FORMATOS = [
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
];

/** Nombre legible de un formato de ZXing, para el diagnóstico. */
function nombreFormato(f: number | undefined): string {
  if (f === undefined || f === null) return "desconocido";
  return BarcodeFormat[f] ?? String(f);
}

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

  // Diagnóstico: lo ÚLTIMO que la cámara logró decodificar, tal cual, antes de
  // limpiarlo o cruzarlo con nada. Es lo que distingue "no lee" de "lee algo
  // distinto a lo que esperábamos", que son dos problemas sin nada en común.
  const [crudo, setCrudo] = useState<{ texto: string; formato: string } | null>(null);
  const [resolucion, setResolucion] = useState<string | null>(null);
  const [verDiagnostico, setVerDiagnostico] = useState(false);

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
        hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATOS);
        hints.set(DecodeHintType.TRY_HARDER, true);

        // 120 ms entre intentos en vez de los 500 por defecto. Con la mano
        // temblando y el enfoque yendo y viniendo, dos intentos por segundo
        // desperdician casi todos los fotogramas nítidos.
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 800,
        });

        const video: MediaTrackConstraints = {
          // Cámara trasera: es la que apunta al carné.
          facingMode: { ideal: "environment" },
          // Resolución alta: sin esto el navegador entrega 640×480 y las barras
          // finas se pierden. `ideal` y no `exact` para que degrade en vez de
          // fallar si la cámara no llega.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        };

        // `focusMode` existe en la especificación de Media Capture pero no en
        // los tipos de TypeScript, así que se asigna aparte. Va dentro de
        // `advanced` a propósito: una restricción desconocida ahí se ignora en
        // silencio, mientras que en el nivel superior tumbaría getUserMedia en
        // los navegadores que no la conocen.
        (video as { advanced?: unknown[] }).advanced = [{ focusMode: "continuous" }];

        const controls = await reader.decodeFromConstraints(
          { video },
          videoRef.current!,
          (result) => {
            if (!result) return;
            // Se registra SIEMPRE lo leído, aunque luego no cruce con nada.
            setCrudo({
              texto: result.getText(),
              formato: nombreFormato(result.getBarcodeFormat()),
            });
            void procesar(result.getText());
          }
        );

        // Resolución realmente concedida: puede ser menor que la pedida y eso
        // explica por sí solo muchas lecturas fallidas.
        const pista = videoRef.current?.srcObject as MediaStream | null;
        const ajustes = pista?.getVideoTracks?.()[0]?.getSettings?.();
        if (ajustes?.width && ajustes?.height) {
          setResolucion(`${ajustes.width}×${ajustes.height}`);
        }

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
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--umng-muted)]">
            Apunta al código de barras del carné. Se registra solo.
          </p>
          <button
            type="button"
            onClick={() => setVerDiagnostico((v) => !v)}
            className="text-xs text-[var(--umng-navy)] underline underline-offset-2"
          >
            {verDiagnostico ? "Ocultar diagnóstico" : "Diagnóstico"}
          </button>
        </div>
      )}

      {/* Diagnóstico: lo que la cámara ve DE VERDAD.
          Sin esto, "no lee" es indistinguible de "lee otra cosa", y son dos
          problemas con soluciones opuestas. */}
      {verDiagnostico && !error && (
        <div className="mt-2 rounded-lg border border-[var(--umng-navy-100)] bg-white px-3 py-2 text-xs">
          <p className="text-[var(--umng-muted)]">
            Resolución de la cámara:{" "}
            <span className="font-data text-[var(--umng-ink)]">
              {resolucion ?? "…"}
            </span>
            {resolucion && Number(resolucion.split("×")[0]) < 1280 && (
              <span className="ml-1 text-[var(--umng-crimson)]">
                (baja: puede impedir la lectura)
              </span>
            )}
          </p>
          <p className="mt-1 text-[var(--umng-muted)]">Última lectura cruda:</p>
          {crudo ? (
            <p className="mt-0.5 font-data break-all text-[var(--umng-ink)]">
              «{crudo.texto}»{" "}
              <span className="text-[var(--umng-muted)]">[{crudo.formato}]</span>
            </p>
          ) : (
            <p className="mt-0.5 text-[var(--umng-muted)]">
              Todavía nada. Si la cámara enfoca bien y esto sigue vacío, el
              código no está entre los formatos que el lector acepta.
            </p>
          )}
        </div>
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
