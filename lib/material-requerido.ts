// lib/material-requerido.ts
// Nota libre "Observaciones o material requerido" del formulario de /reservar.
//
// ES UNA NOTA, NO INVENTARIO. El laboratorista la lee y decide; no hay catálogo
// de equipos, ni estados de préstamo, ni descuento de stock (AGENTS.md: el
// préstamo está fuera de alcance). Migración 0031.
//
// Vive aquí y no en la Server Action porque la usan los dos lados: el wizard
// (para el maxLength y el contador) y el servidor (para normalizar). Un archivo
// "use server" solo puede exportar funciones async, no constantes.

/** Tope de caracteres. El RPC aplica el mismo recorte: no confiar en el navegador. */
export const MAX_MATERIAL = 500;

/**
 * Misma regla que el RPC: sin espacios ni saltos de línea en los extremos,
 * recortada a MAX_MATERIAL, y en blanco → null (nunca cadena vacía).
 */
export function normalizarMaterial(texto: string | null | undefined): string | null {
  const limpio = (texto ?? "").trim().slice(0, MAX_MATERIAL).trim();
  return limpio.length > 0 ? limpio : null;
}
