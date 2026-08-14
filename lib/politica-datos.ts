// lib/politica-datos.ts — versión vigente de la política de tratamiento de datos.
//
// La versión se guarda EN CADA RESERVA (reservations.consent_version). Así, si
// mañana cambia la política, queda registro de cuál aceptó exactamente cada
// persona: eso es lo que permite responder con precisión ante un reclamo.
//
// ⚠️ AL CAMBIAR EL TEXTO DE LA POLÍTICA, SUBE LA VERSIÓN. Si no, quedarían
// reservas apuntando a una versión cuyo contenido ya no es el que aceptaron.

export const POLITICA_VERSION = "1.0";

/** Fecha de entrada en vigencia de esta versión (Decreto 1377 de 2013, art. 13). */
export const POLITICA_VIGENCIA = "agosto de 2026";

/**
 * Datos de contacto del Responsable del Tratamiento.
 * PENDIENTE: la UMNG debe confirmar el correo y la dependencia exactos ante los
 * que se atienden consultas y reclamos de habeas data.
 */
export const RESPONSABLE = {
  nombre: "Universidad Militar Nueva Granada — División de Laboratorios",
  direccion: "Carrera 11 # 101-80, Bogotá D.C., Colombia",
  telefono: "(601) 650 00 00",
  correo: "divlaboratorios@unimilitar.edu.co", // ← confirmar con la UMNG
};
