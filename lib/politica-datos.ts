// lib/politica-datos.ts — versión vigente de la política de tratamiento de datos.
//
// La versión se guarda EN CADA RESERVA (reservations.consent_version). Así, si
// mañana cambia la política, queda registro de cuál aceptó exactamente cada
// persona: eso es lo que permite responder con precisión ante un reclamo.
//
// ⚠️ AL CAMBIAR EL TEXTO DE LA POLÍTICA, SUBE LA VERSIÓN. Si no, quedarían
// reservas apuntando a una versión cuyo contenido ya no es el que aceptaron.

// 1.1 (agosto 2026) — el responsable pasa a nombrarse de forma genérica
//     ("el administrador de la plataforma") en vez de citar a la UMNG.
// 1.0 (agosto 2026) — versión inicial.
export const POLITICA_VERSION = "1.1";

/** Fecha de entrada en vigencia de esta versión (Decreto 1377 de 2013, art. 13). */
export const POLITICA_VIGENCIA = "agosto de 2026";

/**
 * Cómo se nombra al Responsable del Tratamiento en toda la plataforma.
 *
 * Se redacta en genérico a propósito: la plataforma puede operarla la División
 * de Laboratorios hoy y otra dependencia mañana, y el texto no debería tener que
 * reescribirse por eso. Al estar centralizado aquí, cambiar el nombre en el
 * formulario y en la política es tocar un solo archivo.
 *
 * ⚠️ LÍMITE LEGAL DE LO GENÉRICO. El artículo 13 del Decreto 1377 de 2013 exige
 * que la política identifique al responsable y ofrezca un canal real de
 * atención. Un nombre genérico es admisible; quedarse sin canal de contacto no
 * lo es. Por eso `correo` sigue siendo obligatorio: es la vía por la que un
 * estudiante ejerce sus derechos de conocer, rectificar y suprimir.
 */
export const RESPONSABLE = {
  nombre: "Administrador de la plataforma de reserva de laboratorios",
  /** Canal de habeas data. Debe ser un buzón que alguien atienda de verdad. */
  correo: "divlaboratorios@unimilitar.edu.co", // ← confirmar con la institución
};

/**
 * Texto exacto de la casilla de autorización del formulario público.
 *
 * Vive aquí y no dentro del componente porque es la frase que el estudiante
 * acepta y que queda amparada por `consent_version` en su reserva. Si cambia,
 * hay que subir POLITICA_VERSION en el mismo commit: son la misma decisión.
 */
export const TEXTO_AUTORIZACION =
  "Autorizo al administrador de la plataforma a tratar mis datos personales " +
  "para gestionar mi práctica de laboratorio y el control de asistencia, " +
  "conforme a la política de tratamiento de datos.";
