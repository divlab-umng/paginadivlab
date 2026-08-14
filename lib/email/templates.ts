// lib/email/templates.ts — plantillas HTML con identidad UMNG.
//
// HTML de correo, no HTML de web: estilos EN LÍNEA y tablas para maquetar.
// Gmail y Outlook descartan <style> y clases, así que aquí no sirven Tailwind
// ni las variables CSS del sitio; los colores del escudo van literales.

const NAVY = "#0B254E";
const CRIMSON = "#C41E3A";
const GOLD = "#FDB913";
const GREEN = "#2E7D32";
const INK = "#0F1B2D";
const MUTED = "#5B6472";
const BORDER = "#E3E6EC";
const SURFACE = "#F7F8FA";

export type FranjaCorreo = {
  labName: string;
  sessionDate: string; // YYYY-MM-DD
  startTime: string;   // HH:MM:SS
  endTime: string;     // HH:MM:SS
};

function fechaLarga(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const s = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const hhmm = (t: string) => t.slice(0, 5);
const limpio = (n: string) => n.replace(/^LABORATORIO\s+/i, "");

/**
 * Escapa texto escrito por una persona antes de meterlo en el HTML del correo.
 *
 * NO ES OPCIONAL. Las instrucciones de seguridad las redacta el laboratorista
 * desde su panel, en texto libre. Un `&` en "Gafas & guantes" o un `<` en
 * "temperatura < 40°" romperían la maqueta del mensaje, y cualquier etiqueta
 * pegada por accidente se interpretaría como HTML.
 */
function escapar(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Instrucciones genéricas: se usan cuando el laboratorio no definió las suyas. */
const SEGURIDAD_GENERICA = [
  "Llega <strong>10 minutos antes</strong> de la hora de inicio.",
  "Trae tu <strong>carné estudiantil</strong>: la asistencia se registra escaneando su código de barras.",
  "Usa <strong>calzado cerrado</strong> y la <strong>bata o elementos de protección</strong> que exija el laboratorio.",
  "No se permite el ingreso de <strong>alimentos ni bebidas</strong>.",
  "Sigue en todo momento las indicaciones del laboratorista.",
];

/**
 * Convierte las instrucciones en viñetas.
 * El laboratorista escribe una por línea; se ignoran las vacías y se admite que
 * empiece cada línea con "-" o "•", que es como la gente escribe listas.
 */
function vinetasSeguridad(notasLab?: string | null): string {
  const propias = (notasLab ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean)
    .map(escapar); // texto de persona → escapar SIEMPRE

  const items = propias.length > 0 ? propias : SEGURIDAD_GENERICA;

  return items
    .map(
      (t) =>
        `<li style="margin:0 0 6px;font-size:13px;color:${MUTED};line-height:1.5;">${t}</li>`
    )
    .join("");
}

function envoltura(contenido: string, colorCabecera: string, titulo: string) {
  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `
<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:${SURFACE};font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
    <tr><td style="background:${colorCabecera};padding:24px;">
      <p style="margin:0;font-size:11px;letter-spacing:2px;color:${GOLD};text-transform:uppercase;">Universidad Militar Nueva Granada</p>
      <h1 style="margin:6px 0 0;font-size:20px;color:#ffffff;font-weight:600;">${titulo}</h1>
    </td></tr>
    <tr><td style="padding:24px;">${contenido}</td></tr>
    <tr><td style="padding:16px 24px;background:${SURFACE};border-top:1px solid ${BORDER};">
      <p style="margin:0;font-size:12px;color:${MUTED};">
        Consulta o cancela tus reservas en
        <a href="${sitio}/consulta" style="color:${NAVY};font-weight:bold;">${sitio}/consulta</a>
      </p>
      <p style="margin:8px 0 0;font-size:11px;color:${MUTED};">
        División de Laboratorios · UMNG. Este mensaje es automático, no respondas a este correo.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Correo 3 — al LABORATORISTA: llegaron solicitudes nuevas a su laboratorio.
 * Sin este aviso tendría que entrar al panel a mirar "por si acaso", que es
 * justo el trabajo manual que la plataforma vino a quitar.
 */
export function correoNuevaSolicitud(params: {
  laboratorista: string | null;
  labName: string;
  solicitudes: {
    estudiante: string;
    codigo: string;
    materia: string | null;
    sessionDate: string;
    startTime: string;
    endTime: string;
    enGrupo: boolean;
  }[];
}) {
  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const n = params.solicitudes.length;
  const plural = n !== 1;

  const filas = params.solicitudes
    .map(
      (s) => `
      <tr><td style="padding:10px 12px;border:1px solid ${BORDER};border-radius:8px;">
        <p style="margin:0;font-size:14px;font-weight:bold;color:${INK};">
          ${s.estudiante} <span style="font-family:monospace;font-weight:normal;color:${MUTED};">${s.codigo}</span>
          ${s.enGrupo ? `<span style="font-size:11px;color:${NAVY};"> · grupo</span>` : ""}
        </p>
        <p style="margin:4px 0 0;font-size:13px;color:${MUTED};">
          ${fechaLarga(s.sessionDate)} · ${hhmm(s.startTime)}–${hhmm(s.endTime)}
          ${s.materia ? ` · ${s.materia}` : ""}
        </p>
      </td></tr>
      <tr><td style="height:8px;"></td></tr>`
    )
    .join("");

  const contenido = `
    <p style="margin:0 0 16px;font-size:15px;">Hola${
      params.laboratorista ? ` <strong>${params.laboratorista}</strong>` : ""
    },</p>
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};">
      ${plural ? "Tienes" : "Tienes"} <strong style="color:${INK};">${n} ${
        plural ? "solicitudes nuevas" : "solicitud nueva"
      }</strong> en <strong style="color:${INK};">${limpio(params.labName)}</strong>,
      a la espera de tu aprobación.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${filas}</table>
    <p style="margin:20px 0 0;">
      <a href="${sitio}/panel"
         style="display:inline-block;background:${CRIMSON};color:#ffffff;text-decoration:none;
                padding:12px 20px;border-radius:8px;font-size:14px;font-weight:bold;">
        Revisar en el panel
      </a>
    </p>
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">
      Recuerda que el cupo ya quedó reservado mientras decides: si rechazas, se
      libera de inmediato para otro estudiante.
    </p>`;

  return {
    asunto: `${n} ${plural ? "solicitudes nuevas" : "solicitud nueva"} · ${limpio(
      params.labName
    )}`,
    html: envoltura(contenido, NAVY, plural ? "Solicitudes nuevas" : "Solicitud nueva"),
  };
}

/**
 * Correo 2 — PRÁCTICA APROBADA. Es el único correo que recibe el estudiante.
 *
 * Por decisión de la División (agosto 2026), no se envía nada al crear la
 * solicitud ni al rechazarla: el estudiante consulta su estado en /consulta.
 * Por eso este mensaje concentra TODO lo que necesita saber para presentarse:
 * cuándo, dónde, qué llevar y qué normas cumplir.
 */
export function correoPracticaAprobada(params: {
  nombre: string;
  codigo: string;
  materia: string | null;
  franja: FranjaCorreo;
  /** Integrantes del grupo, sin incluir al destinatario. */
  companeros?: string[];
  /** Instrucciones propias del laboratorio. Si viene vacío, se usan las genéricas. */
  instrucciones?: string | null;
}) {
  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const f = params.franja;
  const seguridad = vinetasSeguridad(params.instrucciones);

  const contenido = `
    <p style="margin:0 0 16px;font-size:15px;">Hola <strong>${params.nombre}</strong>,</p>
    <p style="margin:0 0 18px;font-size:14px;color:${MUTED};">
      Tu solicitud fue <strong style="color:${GREEN};">aprobada</strong>. Ya tienes tu cupo
      reservado para la práctica.
    </p>

    <!-- Datos de la práctica -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border:1px solid ${BORDER};border-radius:10px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Laboratorio</p>
        <p style="margin:0 0 14px;font-size:16px;font-weight:bold;color:${INK};">${limpio(f.labName)}</p>

        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Fecha y hora</p>
        <p style="margin:0 0 14px;font-size:15px;color:${INK};">
          ${fechaLarga(f.sessionDate)}<br>
          <strong>${hhmm(f.startTime)} a ${hhmm(f.endTime)}</strong>
        </p>

        ${
          params.materia
            ? `<p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Materia</p>
               <p style="margin:0 0 14px;font-size:14px;color:${INK};">${params.materia}</p>`
            : ""
        }

        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Código de estudiante</p>
        <p style="margin:0;font-size:14px;font-family:monospace;color:${INK};">${params.codigo}</p>

        ${
          params.companeros && params.companeros.length > 0
            ? `<p style="margin:14px 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Grupo de trabajo</p>
               <p style="margin:0;font-size:14px;color:${INK};">${params.companeros.join(", ")}</p>`
            : ""
        }
      </td></tr>
    </table>

    <!-- Instrucciones de seguridad -->
    <div style="margin:20px 0 0;padding:14px 16px;background:${SURFACE};border-left:3px solid ${GOLD};">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:${INK};">
        Antes de ingresar a la práctica
      </p>
      <ul style="margin:0;padding-left:18px;">${seguridad}</ul>
    </div>

    <p style="margin:20px 0 0;font-size:13px;color:${MUTED};">
      Si ya no puedes asistir,
      <a href="${sitio}/consulta" style="color:${NAVY};font-weight:bold;">cancela tu reserva</a>
      para liberar el cupo a otro estudiante.
    </p>`;

  return {
    asunto: `Práctica aprobada · ${limpio(f.labName)} · ${fechaLarga(f.sessionDate)}`,
    html: envoltura(contenido, GREEN, "Práctica aprobada"),
  };
}

/**
 * Correo 4 — SOLICITUD RECHAZADA.
 *
 * Sin este aviso el estudiante queda esperando indefinidamente un correo de
 * aprobación que nunca va a llegar, y pierde la oportunidad de buscar otra
 * franja a tiempo. El motivo se muestra cuando el laboratorista lo escribió:
 * un rechazo sin explicación genera más consultas de las que ahorra.
 */
export function correoSolicitudRechazada(params: {
  nombre: string;
  materia: string | null;
  franja: FranjaCorreo;
  motivo?: string | null;
}) {
  const sitio = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const f = params.franja;
  const motivo = (params.motivo ?? "").trim();

  const contenido = `
    <p style="margin:0 0 16px;font-size:15px;">Hola <strong>${escapar(params.nombre)}</strong>,</p>
    <p style="margin:0 0 18px;font-size:14px;color:${MUTED};">
      Tu solicitud de práctica <strong style="color:${CRIMSON};">no fue aprobada</strong>.
      El cupo quedó liberado, así que puedes solicitar otra franja disponible.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border:1px solid ${BORDER};border-radius:10px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Laboratorio</p>
        <p style="margin:0 0 14px;font-size:16px;font-weight:bold;color:${INK};">${limpio(f.labName)}</p>

        <p style="margin:0 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Franja solicitada</p>
        <p style="margin:0;font-size:15px;color:${INK};">
          ${fechaLarga(f.sessionDate)}<br>
          <strong>${hhmm(f.startTime)} a ${hhmm(f.endTime)}</strong>
        </p>

        ${
          params.materia
            ? `<p style="margin:14px 0 2px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Materia</p>
               <p style="margin:0;font-size:14px;color:${INK};">${escapar(params.materia)}</p>`
            : ""
        }
      </td></tr>
    </table>

    ${
      motivo
        ? `<div style="margin:20px 0 0;padding:14px 16px;background:${SURFACE};border-left:3px solid ${CRIMSON};">
             <p style="margin:0 0 6px;font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Motivo</p>
             <p style="margin:0;font-size:14px;color:${INK};line-height:1.5;">${escapar(motivo)}</p>
           </div>`
        : ""
    }

    <p style="margin:20px 0 0;">
      <a href="${sitio}/reservar"
         style="display:inline-block;background:${CRIMSON};color:#ffffff;text-decoration:none;
                padding:12px 20px;border-radius:8px;font-size:14px;font-weight:bold;">
        Solicitar otra franja
      </a>
    </p>

    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">
      Si tienes dudas sobre la decisión, comunícate con el laboratorio antes de
      volver a solicitar.
    </p>`;

  return {
    asunto: `Solicitud no aprobada · ${limpio(f.labName)}`,
    html: envoltura(contenido, CRIMSON, "Solicitud no aprobada"),
  };
}
