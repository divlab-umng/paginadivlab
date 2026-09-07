// lib/qr.ts — código QR como SVG, generado en el servidor.
//
// POR QUÉ EN EL SERVIDOR Y NO EN EL NAVEGADOR
//   Lo habitual es generar el QR con JavaScript en el cliente, pero eso obliga
//   a enviarle la librería a cada visitante. Aquí se dibuja en el servidor y
//   solo viaja el SVG ya hecho: unos pocos KB de vector en vez de la librería
//   entera. El navegador no ejecuta nada.
//
// POR QUÉ SVG Y NO PNG
//   Un SVG es vectorial: se imprime nítido a cualquier tamaño, desde el QR
//   pequeño del panel hasta un cartel de media hoja. Con PNG habría que elegir
//   una resolución de antemano y quedaría pixelado al ampliarlo.
//
// POR QUÉ `qrcode-generator` Y NO `node-qrcode`
//   Cero dependencias transitivas, frente a las 29 del otro —que arrastra hasta
//   `yargs`, usado solo por su herramienta de línea de comandos—. Este proyecto
//   ya escribe su propio generador de .xlsx para no arrastrar dependencias;
//   traer 29 paquetes para dibujar cuadrados contradice esa línea.
import qrcode from "qrcode-generator";

export type OpcionesQr = {
  /** Módulos en blanco alrededor. El estándar pide 4: menos y algunos lectores fallan. */
  margen?: number;
  /** Color de los módulos oscuros. */
  color?: string;
  /** Color del fondo. `null` lo deja transparente. */
  fondo?: string | null;
};

/**
 * Devuelve el QR como una cadena SVG lista para incrustar.
 *
 * Corrección de errores en nivel Q (25%): más alto de lo habitual a propósito.
 * Estos códigos van impresos y pegados en la puerta de un laboratorio, donde
 * se rayan, se despegan por una esquina y les da el reflejo de la luz del
 * techo. Un nivel M se vuelve ilegible con daños que Q todavía tolera, y el
 * coste es un código apenas más denso.
 */
export function qrSvg(texto: string, opciones: OpcionesQr = {}): string {
  const {
    margen = 4,
    color = "#0d2f5f", // azul institucional; el negro puro no hace falta
    fondo = "#ffffff",
  } = opciones;

  const qr = qrcode(0, "Q"); // 0 = versión automática según la longitud
  qr.addData(texto);
  qr.make();

  const n = qr.getModuleCount();
  const lado = n + margen * 2;

  // Se dibuja UN solo path fusionando los módulos oscuros contiguos de cada
  // fila. Un rectángulo por módulo daría un SVG cuatro veces más grande sin
  // ninguna diferencia visible.
  let d = "";
  for (let fila = 0; fila < n; fila++) {
    let col = 0;
    while (col < n) {
      if (!qr.isDark(fila, col)) {
        col++;
        continue;
      }
      let largo = 1;
      while (col + largo < n && qr.isDark(fila, col + largo)) largo++;
      d += `M${col + margen} ${fila + margen}h${largo}v1h-${largo}z`;
      col += largo;
    }
  }

  // `shape-rendering="crispEdges"` evita que el antialiasing difumine el borde
  // de los módulos: a tamaño pequeño esa difuminación confunde a los lectores.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}"`,
    ` width="100%" height="100%" shape-rendering="crispEdges" role="img"`,
    ` aria-label="Código QR">`,
    fondo ? `<rect width="${lado}" height="${lado}" fill="${fondo}"/>` : "",
    `<path d="${d}" fill="${color}"/>`,
    `</svg>`,
  ].join("");
}
