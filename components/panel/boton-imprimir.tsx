// components/panel/boton-imprimir.tsx
// Lo único de la página del cartel que necesita JavaScript.
//
// Va aislado a propósito: así el cartel —incluido el QR, que es SVG servido
// desde el servidor— llega como HTML puro y se puede imprimir con Ctrl+P
// aunque el script no cargue. El botón es una comodidad, no un requisito.
"use client";

export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
      style={{ backgroundColor: "var(--umng-navy)" }}
    >
      Imprimir cartel
    </button>
  );
}
