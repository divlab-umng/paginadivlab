// components/panel/walk-in-form.tsx
// Entrada inmediata: registrar al estudiante que llegó sin reserva.
//
// EL ORDEN DE LOS CAMPOS NO ES CASUAL
//   Primero el código, porque es lo único que el laboratorista tiene siempre a
//   mano —está impreso en el carné— y porque si la persona ya vino antes, ese
//   solo dato completa nombre y correo. Los campos de identidad aparecen
//   atenuados cuando se rellenan solos: comunican "ya te conocemos, sigue".
//
// POR QUÉ SE PUEDE ESCANEAR
//   Se reutiliza el mismo BarcodeScanner del registro de asistencia. Con las
//   manos ocupadas y una fila de estudiantes esperando, teclear siete dígitos
//   por persona es el cuello de botella real.
"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { BarcodeScanner } from "@/components/panel/barcode-scanner";
import {
  buscarEstudiante,
  registrarWalkInAction,
  type WalkInState,
} from "@/app/(laboratorista)/panel/walk-in-actions";

export type LabOpcion = { code: string; name: string };
export type MateriaOpcion = { id: string; name: string; lab_code: string };
export type CarreraOpcion = { id: string; name: string };

const inicial: WalkInState = {};

export function WalkInForm({
  labs,
  materias,
  carreras,
}: {
  labs: LabOpcion[];
  materias: MateriaOpcion[];
  carreras: CarreraOpcion[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(registrarWalkInAction, inicial);

  const [labCode, setLabCode] = useState(labs[0]?.code ?? "");
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [conocido, setConocido] = useState(false);
  const [buscando, startBusqueda] = useTransition();
  const [escaneando, setEscaneando] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  // Limpia el formulario tras un registro correcto: lo normal es que venga otro
  // estudiante detrás, y dejar los datos del anterior invita a registrarlo dos
  // veces sin darse cuenta.
  //
  // Se ajusta el estado DURANTE EL RENDER y no en un `useEffect`. Es el patrón
  // que React documenta para "reaccionar a un cambio de valor": la guarda del
  // `if` corta el ciclo y React reinicia el render antes de pintar nada, así
  // que el usuario nunca ve el formulario con los datos viejos. Con un efecto
  // habría un pintado intermedio y, además, cascada de renders.
  const [nonceVisto, setNonceVisto] = useState<number | null>(null);
  if (state.ok && state.nonce != null && state.nonce !== nonceVisto) {
    setNonceVisto(state.nonce);
    setCodigo("");
    setNombre("");
    setCorreo("");
    setConocido(false);
  }

  const materiasDelLab = materias.filter((m) => m.lab_code === labCode);

  function consultarCodigo(valor: string) {
    const limpio = valor.replace(/\D/g, "");
    if (limpio.length < 5) {
      setConocido(false);
      return;
    }
    startBusqueda(async () => {
      const est = await buscarEstudiante(limpio);
      if (est) {
        setNombre(est.full_name ?? "");
        setCorreo(est.email ?? "");
        setConocido(true);
      } else {
        setConocido(false);
      }
    });
  }

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="btn-secondary text-sm">
        Entrada inmediata (walk-in)
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--umng-gold)] bg-amber-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-[var(--umng-navy)]">
            Entrada inmediata
          </h4>
          <p className="mt-0.5 text-xs text-[var(--umng-ink)]/60">
            Para quien llega sin reserva. Queda aprobada y con asistencia marcada,
            y cuenta en el aforo igual que cualquier otra.
          </p>
        </div>
        <button
          onClick={() => setAbierto(false)}
          className="text-xs text-[var(--umng-ink)]/60 hover:text-[var(--umng-ink)]"
        >
          Cerrar
        </button>
      </div>

      {escaneando ? (
        <div className="mb-4">
          <BarcodeScanner
            onCerrar={() => setEscaneando(false)}
            onCodigo={async (leido) => {
              setCodigo(leido);
              consultarCodigo(leido);
              setEscaneando(false);
              return {
                ok: true,
                motivo: "marcado" as const,
                codigo: leido,
                mensaje: "Código capturado. Completa y confirma.",
              };
            }}
          />
        </div>
      ) : null}

      <form ref={formRef} action={formAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-[var(--umng-ink)]/70">
              Laboratorio
            </span>
            <select
              name="lab_code"
              value={labCode}
              onChange={(e) => setLabCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {labs.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--umng-ink)]/70">
              Código del carné
            </span>
            <div className="mt-1 flex gap-2">
              <input
                name="student_code"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onBlur={(e) => consultarCodigo(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="1234567"
                className="w-full rounded-md border border-gray-300 px-3 py-2 font-data text-sm"
              />
              <button
                type="button"
                onClick={() => setEscaneando(true)}
                className="shrink-0 rounded-md border border-gray-300 px-3 text-xs font-medium"
              >
                Escanear
              </button>
            </div>
          </label>
        </div>

        {conocido ? (
          <p className="text-xs text-[var(--umng-green)]">
            Estudiante ya registrado. Datos completados automáticamente.
          </p>
        ) : buscando ? (
          <p className="text-xs text-[var(--umng-ink)]/50">Buscando…</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-[var(--umng-ink)]/70">
              Nombre completo
            </span>
            <input
              name="student_name"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                setConocido(false);
              }}
              placeholder="Solo si es la primera vez"
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                conocido
                  ? "border-gray-200 bg-gray-50 text-[var(--umng-ink)]/60"
                  : "border-gray-300"
              }`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--umng-ink)]/70">
              Correo institucional
            </span>
            <input
              name="student_email"
              type="email"
              value={correo}
              onChange={(e) => {
                setCorreo(e.target.value);
                setConocido(false);
              }}
              placeholder="usuario@unimilitar.edu.co"
              className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                conocido
                  ? "border-gray-200 bg-gray-50 text-[var(--umng-ink)]/60"
                  : "border-gray-300"
              }`}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-[var(--umng-ink)]/70">
              Materia <span className="font-normal">(opcional)</span>
            </span>
            <select
              name="subject_id"
              defaultValue=""
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">— Sin materia —</option>
              {materiasDelLab.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[var(--umng-ink)]/70">
              Carrera <span className="font-normal">(opcional)</span>
            </span>
            <select
              name="program_id"
              defaultValue=""
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">— Sin carrera —</option>
              {carreras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={pending}
            className="btn-primary text-sm disabled:opacity-60"
          >
            {pending ? "Registrando…" : "Registrar entrada"}
          </button>
          <span className="text-xs text-[var(--umng-ink)]/50">
            Se registra en la sesión que esté en curso; si no hay ninguna, como
            práctica libre.
          </span>
        </div>

        {/* Enlace para que el estudiante se anuncie solo. Convertido en código
            QR e impreso en la puerta, ahorra el diligenciamiento manual: el
            laboratorista solo escanea el carné para confirmar. */}
        <EnlaceAutoServicio labCode={labCode} />

        {state.error && (
          <p className="rounded-md border border-[var(--umng-crimson)] bg-red-50 p-3 text-sm text-[var(--umng-ink)]">
            {state.error}
          </p>
        )}

        {state.ok && state.mensaje && (
          <p className="rounded-md border border-[var(--umng-green)] bg-green-50 p-3 text-sm text-[var(--umng-ink)]">
            {state.mensaje}
            {typeof state.cuposRestantes === "number" && (
              <span className="ml-1 font-data text-xs text-[var(--umng-ink)]/60">
                Quedan {state.cuposRestantes} cupos.
              </span>
            )}
          </p>
        )}
      </form>
    </div>
  );
}

/**
 * Enlace de autoservicio para pegar en la puerta.
 *
 * Se muestra el enlace en texto en vez de dibujar el código QR aquí: generarlo
 * exigiría una librería nueva (~50 KB) para algo que se imprime UNA vez por
 * laboratorio y se pega con cinta. Con el enlace copiado, cualquier generador
 * gratuito produce el PNG para imprimir.
 *
 * `window.location.origin` y no una variable de entorno: así el enlace siempre
 * apunta al dominio por el que el laboratorista entró —producción, preview o
 * localhost— sin depender de que alguien recuerde redesplegar tras cambiarla.
 */
function EnlaceAutoServicio({ labCode }: { labCode: string }) {
  const [copiado, setCopiado] = useState(false);
  const url =
    typeof window === "undefined"
      ? `/entrada/${labCode}`
      : `${window.location.origin}/entrada/${labCode}`;

  return (
    <div className="mt-2 rounded-lg border border-dashed border-[var(--umng-navy)]/30 bg-white/60 p-3">
      <p className="text-xs font-medium text-[var(--umng-ink)]/70">
        Que el estudiante escriba sus propios datos
      </p>
      <p className="mt-0.5 text-xs text-[var(--umng-ink)]/55">
        Convierte este enlace en un código QR, imprímelo y pégalo en la puerta.
        Quien lo escanee queda anunciado y tú solo confirmas con el carné.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="flex-1 truncate rounded border border-gray-200 bg-white px-2 py-1 font-data text-xs text-[var(--umng-ink)]/80">
          {url}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => {
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            });
          }}
          className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium"
        >
          {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
