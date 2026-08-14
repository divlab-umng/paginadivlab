// lib/email/resend.ts — envío de correos, deliberadamente "best-effort".
//
// REGLA DE ORO: un fallo de correo NUNCA puede tumbar la operación principal.
// Una reserva creada con éxito sigue siendo válida aunque el correo no salga.
// Por eso `enviarCorreo` no lanza excepciones: registra en consola y devuelve
// un resultado que quien llama puede ignorar sin riesgo.
//
// REINTENTOS
//   Se reintenta solo lo que tiene sentido reintentar: cortes de red, límite de
//   tasa (429) y errores del servidor (5xx). Un fallo de configuración —clave
//   inválida, dominio sin verificar, destinatario no permitido— no mejora por
//   insistir: se devuelve de inmediato para no retrasar la respuesta al usuario
//   ni gastar cuota.

import { Resend } from "resend";

// Remitente. Se puede sobrescribir con EMAIL_FROM.
//
// El valor por defecto es el dominio YA VERIFICADO en Resend
// (labs.innovalaboratories.org, agosto 2026), no el `onboarding@resend.dev` de
// pruebas. La diferencia importa: si alguien olvida definir EMAIL_FROM en
// Vercel, con el remitente de pruebas los correos SOLO llegarían al dueño de la
// cuenta de Resend, y el fallo sería silencioso y desconcertante. Con el
// remitente real, funciona igual.
const FROM =
  process.env.EMAIL_FROM ??
  "Laboratorios UMNG <laboratorios@labs.innovalaboratories.org>";

/** Intentos totales (1 original + 2 reintentos) y espera base entre ellos. */
const MAX_INTENTOS = 3;
const ESPERA_BASE_MS = 400;

export type EnvioResult =
  | { enviado: true; intentos: number }
  | { enviado: false; motivo: "sin_configurar" | "error"; detalle?: string; intentos?: number };

/**
 * ¿Hay clave de Resend configurada?
 * Se usa para AVISAR en el panel del jefe. La degradación silenciosa evita que
 * un fallo de correo tumbe una reserva, pero si además es invisible, nadie se
 * entera de que los avisos llevan semanas sin salir.
 */
export function correoConfigurado(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Remitente vigente, para mostrarlo en el diagnóstico. */
export function remitenteActual(): string {
  return FROM;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Decide si vale la pena reintentar.
 * Los mensajes de Resend son texto; se busca por señales conocidas en vez de
 * códigos, porque el SDK no siempre expone el estado HTTP.
 */
function esTransitorio(mensaje: string): boolean {
  const m = mensaje.toLowerCase();

  // Definitivos: reintentar no cambia nada y solo retrasa la respuesta.
  if (
    m.includes("api key") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("not verified") ||
    m.includes("domain is not") ||
    m.includes("you can only send testing emails") ||
    m.includes("invalid") ||
    m.includes("validation")
  ) {
    return false;
  }

  // Transitorios típicos: red, DNS y saturación del proveedor.
  return (
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("network") ||
    m.includes("fetch failed") ||
    m.includes("unable to fetch") ||      // envoltura del SDK ante fallo de red
    m.includes("could not be resolved") || // no resolvió api.resend.com (DNS)
    m.includes("enotfound") ||
    m.includes("eai_again") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("socket") ||
    m.includes("internal server") ||
    m.includes("service unavailable") ||
    m.includes("bad gateway") ||
    /\b5\d\d\b/.test(m)
  );
}

export async function enviarCorreo(params: {
  para: string;
  asunto: string;
  html: string;
}): Promise<EnvioResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(
      `[email] omitido (falta RESEND_API_KEY) → "${params.asunto}" para ${params.para}`
    );
    return { enviado: false, motivo: "sin_configurar" };
  }

  const resend = new Resend(apiKey);
  let ultimoError = "";

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    try {
      const { error } = await resend.emails.send({
        from: FROM,
        to: params.para,
        subject: params.asunto,
        html: params.html,
      });

      if (!error) {
        if (intento > 1) {
          console.info(`[email] enviado en el intento ${intento} → ${params.para}`);
        }
        return { enviado: true, intentos: intento };
      }

      ultimoError = error.message ?? "error desconocido";

      if (!esTransitorio(ultimoError)) {
        console.error(`[email] error definitivo (sin reintentar): ${ultimoError}`);
        return { enviado: false, motivo: "error", detalle: ultimoError, intentos: intento };
      }
    } catch (e) {
      // Red caída, DNS, socket… normalmente transitorio.
      ultimoError = (e as Error).message ?? "excepción desconocida";
      if (!esTransitorio(ultimoError)) {
        console.error(`[email] excepción definitiva: ${ultimoError}`);
        return { enviado: false, motivo: "error", detalle: ultimoError, intentos: intento };
      }
    }

    if (intento < MAX_INTENTOS) {
      // Espera creciente: 400 ms, luego 800 ms. Suficiente para superar un pico
      // de límite de tasa sin dejar al usuario esperando la confirmación.
      const espera = ESPERA_BASE_MS * 2 ** (intento - 1);
      console.warn(
        `[email] intento ${intento} falló (${ultimoError}). Reintentando en ${espera} ms…`
      );
      await dormir(espera);
    }
  }

  console.error(`[email] agotados ${MAX_INTENTOS} intentos: ${ultimoError}`);
  return { enviado: false, motivo: "error", detalle: ultimoError, intentos: MAX_INTENTOS };
}
