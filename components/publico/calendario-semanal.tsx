// components/publico/calendario-semanal.tsx
// Calendario semanal interactivo del estudiante (Fase 2).
//   · Columnas: lunes a sábado.  · Filas: 6:00 a 19:00.
//   · Solo son clicables las franjas que el laboratorista publicó y que siguen
//     siendo reservables (con cupo y con 24 h de antelación).
//   · Selección múltiple: el estudiante arma su lista y confirma una sola vez.
//
// FECHAS EN HORA LOCAL: nunca usar toISOString() para obtener "YYYY-MM-DD"
// (convierte a UTC y en Colombia devuelve el día anterior). Se arma a mano.
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Sesion = {
  session_id: string;
  session_date: string; // YYYY-MM-DD
  start_time: string;   // HH:MM:SS
  end_time: string;     // HH:MM:SS
  capacity: number;
  reserved: number;
  disponibles: number;
  // Puestos de trabajo (mesas/equipos). null = el bloque no tiene límite.
  workstations: number | null;
  puestos_usados: number;
  puestos_disponibles: number | null;
  // Política de grupos del laboratorio. null o 1 = no admite grupos.
  max_group_size: number | null;
  reservable: boolean;
};

const HORA_INICIO = 6;  // 6:00 a.m.
const HORA_FIN = 19;    // 7:00 p.m.
const SEMANAS_MAX = 4;  // ventana de reserva confirmada con la División
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/* --- Utilidades de fecha (siempre en hora local) ------------------------- */

function ymd(d: Date) {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Lunes de la semana a la que pertenece `d`. */
function lunesDe(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay(); // 0=Dom, 1=Lun … 6=Sáb
  const delta = dow === 0 ? -6 : 1 - dow;
  r.setDate(r.getDate() + delta);
  return r;
}

function sumarDias(d: Date, n: number) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

const hhmm = (t: string) => t.slice(0, 5);
const horaNum = (t: string) => parseInt(t.slice(0, 2), 10);

function rotuloRango(lunes: Date) {
  const sabado = sumarDias(lunes, 5);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(d);
  return `${fmt(lunes)} – ${fmt(sabado)}`;
}

/* --- Componente ---------------------------------------------------------- */

export function CalendarioSemanal({
  labCode,
  seleccion,
  onToggle,
  onDatosLab,
}: {
  labCode: string;
  seleccion: Sesion[];
  onToggle: (s: Sesion) => void;
  /** Avisa al wizard si el lab admite grupos, para mostrar el paso de compañeros. */
  onDatosLab?: (datos: { maxGroupSize: number | null }) => void;
}) {
  const hoy = useMemo(() => new Date(), []);
  const lunesActual = useMemo(() => lunesDe(hoy), [hoy]);
  const [semana, setSemana] = useState(0); // 0 = semana actual

  const lunes = useMemo(() => sumarDias(lunesActual, semana * 7), [lunesActual, semana]);

  // Identifica qué se está mostrando: laboratorio + semana. Sirve para dos cosas
  // a la vez y por eso va junto al resultado en un solo estado:
  //
  //   1) DERIVAR "cargando" en vez de guardarlo aparte. Si la clave del dato que
  //      tengo no es la clave que quiero mostrar, es que aún está cargando. Un
  //      booleano separado puede quedar desincronizado; una comparación no.
  //   2) DESCARTAR RESPUESTAS VIEJAS. Si el estudiante salta de semana rápido,
  //      las peticiones pueden volver en desorden y la vieja pisar a la nueva.
  //      Al guardar la clave con el dato, una respuesta tardía se ignora sola.
  const clave = `${labCode}|${ymd(lunes)}`;

  const [datos, setDatos] = useState<{
    clave: string;
    sesiones: Sesion[];
    error: string | null;
  } | null>(null);

  const cargando = datos?.clave !== clave;
  const sesiones = useMemo(
    () => (datos?.clave === clave ? datos.sesiones : []),
    [datos, clave]
  );
  const error = datos?.clave === clave ? datos.error : null;

  useEffect(() => {
    // `vigente` corta el efecto de la clave anterior: React lo limpia al
    // cambiar de semana, así que la respuesta en vuelo ya no escribe estado.
    let vigente = true;

    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lab_sessions_public", {
        p_lab_code: labCode,
        p_from: ymd(lunes),
        p_to: ymd(sumarDias(lunes, 5)), // hasta el sábado
      });
      if (!vigente) return;

      if (error) {
        setDatos({ clave, sesiones: [], error: error.message });
        return;
      }

      const filas = (data ?? []) as Sesion[];
      setDatos({ clave, sesiones: filas, error: null });
      // max_group_size viene del laboratorio, igual en todas las filas.
      if (filas.length > 0) {
        onDatosLab?.({ maxGroupSize: filas[0].max_group_size ?? null });
      }
    })();

    return () => {
      vigente = false;
    };
  }, [clave, labCode, lunes, onDatosLab]);

  // Índice: "YYYY-MM-DD" → sesiones de ese día
  const porDia = useMemo(() => {
    const m = new Map<string, Sesion[]>();
    for (const s of sesiones) {
      const arr = m.get(s.session_date) ?? [];
      arr.push(s);
      m.set(s.session_date, arr);
    }
    return m;
  }, [sesiones]);

  const seleccionIds = useMemo(
    () => new Set(seleccion.map((s) => s.session_id)),
    [seleccion]
  );

  const horas = useMemo(
    () =>
      Array.from({ length: HORA_FIN - HORA_INICIO }, (_, i) => HORA_INICIO + i),
    []
  );

  const hayAlgo = sesiones.length > 0;

  return (
    <div>
      {/* Navegación de semanas */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setSemana((s) => Math.max(0, s - 1))}
          disabled={semana === 0 || cargando}
          className="btn-secondary text-sm disabled:opacity-40"
        >
          ← Anterior
        </button>

        <div className="text-center">
          <p className="text-sm font-semibold text-[var(--umng-navy)]">
            {rotuloRango(lunes)}
          </p>
          <p className="font-data text-xs text-[var(--umng-muted)]">
            {semana === 0 ? "Esta semana" : `En ${semana} semana${semana > 1 ? "s" : ""}`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setSemana((s) => Math.min(SEMANAS_MAX - 1, s + 1))}
          disabled={semana >= SEMANAS_MAX - 1 || cargando}
          className="btn-secondary text-sm disabled:opacity-40"
        >
          Siguiente →
        </button>
      </div>

      {/* Estados */}
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-[var(--umng-crimson)]/30 bg-[var(--umng-crimson)]/5 px-3 py-2 text-sm text-[var(--umng-crimson)]"
        >
          No se pudo cargar el calendario: {error}
        </p>
      )}

      {/* Grilla (scroll horizontal en móvil, columna de horas fija) */}
      <div className="overflow-x-auto rounded-xl border border-[var(--umng-border)] bg-white">
        <div className="min-w-[640px]">
          {/* Encabezado de días */}
          <div
            className="grid border-b border-[var(--umng-border)] bg-[var(--umng-navy-50)]"
            style={{ gridTemplateColumns: "56px repeat(6, 1fr)" }}
          >
            <div />
            {DIAS.map((d, i) => {
              const fecha = sumarDias(lunes, i);
              const esHoy = ymd(fecha) === ymd(hoy);
              return (
                <div key={d} className="px-1 py-2 text-center">
                  <p
                    className={`text-xs font-semibold ${
                      esHoy ? "text-[var(--umng-sky-600)]" : "text-[var(--umng-navy)]"
                    }`}
                  >
                    {d}
                  </p>
                  <p className="font-data text-[0.7rem] text-[var(--umng-muted)]">
                    {fecha.getDate()}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Cuerpo: filas por hora */}
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: "56px repeat(6, 1fr)",
              gridTemplateRows: `repeat(${horas.length}, 46px)`,
            }}
          >
            {/* Columna de horas */}
            {horas.map((h, i) => (
              <div
                key={`h-${h}`}
                className="border-b border-r border-[var(--umng-border)] pr-1 pt-1 text-right"
                style={{ gridColumn: 1, gridRow: i + 1 }}
              >
                <span className="font-data text-[0.65rem] text-[var(--umng-muted)]">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}

            {/* Celdas de fondo */}
            {horas.map((h, i) =>
              DIAS.map((_, c) => (
                <div
                  key={`bg-${h}-${c}`}
                  className="border-b border-r border-[var(--umng-border)]"
                  style={{ gridColumn: c + 2, gridRow: i + 1 }}
                />
              ))
            )}

            {/* Franjas publicadas */}
            {DIAS.map((_, c) => {
              const fecha = ymd(sumarDias(lunes, c));
              return (porDia.get(fecha) ?? []).map((s) => {
                const inicio = horaNum(s.start_time);
                const fin = horaNum(s.end_time);
                const filaInicio = Math.max(inicio - HORA_INICIO, 0) + 1;
                const filas = Math.max(Math.min(fin, HORA_FIN) - Math.max(inicio, HORA_INICIO), 1);
                const elegido = seleccionIds.has(s.session_id);
                const lleno = s.disponibles <= 0;
                // Un bloque puede tener aforo libre pero ningún puesto de
                // trabajo disponible: son dos restricciones distintas.
                const sinPuestos =
                  s.workstations !== null && (s.puestos_disponibles ?? 0) <= 0;

                return (
                  <button
                    key={s.session_id}
                    type="button"
                    disabled={!s.reservable}
                    onClick={() => onToggle(s)}
                    title={
                      s.reservable
                        ? `${hhmm(s.start_time)}–${hhmm(s.end_time)} · ${s.disponibles} de ${s.capacity} cupos` +
                          (s.workstations !== null
                            ? ` · ${s.puestos_disponibles} de ${s.workstations} puestos`
                            : "")
                        : sinPuestos
                        ? "Sin puestos de trabajo disponibles"
                        : lleno
                        ? "Sin cupo disponible"
                        : "Requiere 24 horas de anticipación"
                    }
                    className="slot m-[2px] overflow-hidden rounded-lg px-1.5 py-1 text-left"
                    data-state={
                      elegido
                        ? "elegido"
                        : !s.reservable
                        ? lleno || sinPuestos
                          ? "lleno"
                          : "cerrado"
                        : "libre"
                    }
                    style={{ gridColumn: c + 2, gridRow: `${filaInicio} / span ${filas}` }}
                  >
                    <span className="block font-data text-[0.65rem] leading-tight">
                      {hhmm(s.start_time)}
                    </span>
                    <span className="block text-[0.65rem] leading-tight">
                      {lleno
                        ? "Lleno"
                        : sinPuestos
                        ? "Sin puestos"
                        : `${s.disponibles} cupos`}
                    </span>
                    {/* Solo se muestra si el bloque tiene puestos configurados */}
                    {s.workstations !== null && !lleno && !sinPuestos && (
                      <span className="block text-[0.6rem] leading-tight opacity-80">
                        {s.puestos_disponibles} puestos
                      </span>
                    )}
                    {elegido && (
                      <span className="block text-[0.65rem] font-bold leading-tight">
                        ✓ Elegido
                      </span>
                    )}
                  </button>
                );
              });
            })}
          </div>
        </div>
      </div>

      {/* Mensajes bajo la grilla */}
      {cargando ? (
        <p className="mt-3 text-sm text-[var(--umng-muted)]">Cargando franjas…</p>
      ) : !hayAlgo && !error ? (
        <p className="mt-3 rounded-lg bg-[var(--umng-surface)] p-4 text-sm text-[var(--umng-muted)]">
          Este laboratorio no tiene franjas publicadas para esta semana. Prueba con
          la semana siguiente.
        </p>
      ) : null}

      {/* Leyenda */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--umng-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded border border-[var(--umng-sky)] bg-[var(--umng-sky-50)]" />
          Disponible
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded bg-[var(--umng-sky)]" />
          Elegida
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-3 w-3 rounded bg-[var(--umng-surface)] ring-1 ring-[var(--umng-border)]" />
          Sin cupo, sin puestos o fuera de plazo
        </span>
      </div>
    </div>
  );
}
