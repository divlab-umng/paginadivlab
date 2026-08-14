// lib/xlsx.ts — generador mínimo de archivos .xlsx, SIN dependencias externas.
//
// POR QUÉ A MANO Y NO CON UNA LIBRERÍA
//   Un .xlsx es un ZIP con unos pocos XML (formato OOXML). Para exportar una
//   tabla plana no hace falta arrastrar exceljs ni SheetJS (megabytes y decenas
//   de dependencias transitivas) al proyecto. Aquí solo se usa `zlib`, que ya
//   viene con Node.
//
// QUÉ SOPORTA (a propósito, lo justo para el reporte del jefe):
//   · una hoja  · encabezados en negrita con fondo institucional
//   · texto, números, booleanos y fechas ya formateadas como texto
//   · ancho de columnas, panel congelado y autofiltro
//
// Escapar el XML no es opcional: los nombres de laboratorio traen "&" y las
// observaciones pueden traer "<". Sin escapar, Excel declara el archivo corrupto.

import { deflateRawSync } from "zlib";

export type Columna = { header: string; width?: number };
export type Celda = string | number | boolean | null | undefined;

/* -------------------------------------------------------------------------- */
/* ZIP (solo lo necesario: deflate + directorio central)                       */
/* -------------------------------------------------------------------------- */

type Entrada = { nombre: string; datos: Buffer };

// CRC-32, requerido por el formato ZIP.
const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function construirZip(entradas: Entrada[]): Buffer {
  const locales: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, "utf8");
    const comprimido = deflateRawSync(e.datos);
    const crc = crc32(e.datos);

    // Cabecera local
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma
    local.writeUInt16LE(20, 4); // versión mínima
    local.writeUInt16LE(0, 6); // banderas
    local.writeUInt16LE(8, 8); // método: deflate
    local.writeUInt16LE(0, 10); // hora
    local.writeUInt16LE(0, 12); // fecha
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locales.push(local, nombre, comprimido);

    // Entrada del directorio central
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // versión creador
    dir.writeUInt16LE(20, 6); // versión mínima
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(comprimido.length, 20);
    dir.writeUInt32LE(e.datos.length, 24);
    dir.writeUInt16LE(nombre.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comentario
    dir.writeUInt16LE(0, 34); // disco
    dir.writeUInt16LE(0, 36); // atributos internos
    dir.writeUInt32LE(0, 38); // atributos externos
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nombre);

    offset += local.length + nombre.length + comprimido.length;
  }

  const cuerpoCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(cuerpoCentral.length, 12);
  fin.writeUInt32LE(offset, 16);
  fin.writeUInt16LE(0, 20);

  return Buffer.concat([...locales, cuerpoCentral, fin]);
}

/* -------------------------------------------------------------------------- */
/* XML de la hoja                                                             */
/* -------------------------------------------------------------------------- */

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Excel rechaza los caracteres de control salvo tab/salto de línea.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/** Número de columna (1) → letra de Excel (A). */
function col(n: number) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function celdaXml(ref: string, valor: Celda, estilo: number) {
  const s = estilo ? ` s="${estilo}"` : "";
  if (valor === null || valor === undefined || valor === "") {
    return `<c r="${ref}"${s}/>`;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  }
  if (typeof valor === "boolean") {
    return `<c r="${ref}"${s} t="b"><v>${valor ? 1 : 0}</v></c>`;
  }
  // Texto en línea: evita tener que mantener la tabla de cadenas compartidas.
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(
    String(valor)
  )}</t></is></c>`;
}

/**
 * Genera un .xlsx de una sola hoja a partir de columnas y filas.
 * Devuelve el Buffer listo para descargar.
 */
export function generarXlsx(params: {
  nombreHoja: string;
  columnas: Columna[];
  filas: Celda[][];
}): Buffer {
  const { columnas, filas } = params;
  const nombreHoja = params.nombreHoja.slice(0, 31).replace(/[\\/*?:[\]]/g, "-");
  const nCols = columnas.length;
  const nFilas = filas.length + 1; // + encabezado

  // Anchos
  const cols = columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join("");

  // Encabezado (estilo 1 = negrita sobre fondo navy)
  const encabezado =
    `<row r="1" ht="22" customHeight="1">` +
    columnas.map((c, i) => celdaXml(`${col(i + 1)}1`, c.header, 1)).join("") +
    `</row>`;

  const cuerpo = filas
    .map((fila, f) => {
      const r = f + 2;
      const celdas = Array.from({ length: nCols }, (_, i) =>
        celdaXml(`${col(i + 1)}${r}`, fila[i], 0)
      ).join("");
      return `<row r="${r}">${celdas}</row>`;
    })
    .join("");

  const rango = `A1:${col(nCols)}${nFilas}`;

  const hoja =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    // Congela la fila de encabezado al hacer scroll.
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${encabezado}${cuerpo}</sheetData>` +
    `<autoFilter ref="${rango}"/>` +
    `</worksheet>`;

  const libro =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${esc(nombreHoja)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`;

  // Estilos: 0 = normal, 1 = encabezado (blanco sobre navy, negrita).
  const estilos =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="3">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF0B254E"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">` +
    `<alignment vertical="center"/></xf>` +
    `</cellXfs>` +
    // Sin el estilo "Normal" declarado, algunos lectores avisan que falta el
    // estilo por defecto. Es la pieza estándar que cierra el styleSheet.
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const relsRaiz =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const relsLibro =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const b = (s: string) => Buffer.from(s, "utf8");

  return construirZip([
    { nombre: "[Content_Types].xml", datos: b(contentTypes) },
    { nombre: "_rels/.rels", datos: b(relsRaiz) },
    { nombre: "xl/workbook.xml", datos: b(libro) },
    { nombre: "xl/_rels/workbook.xml.rels", datos: b(relsLibro) },
    { nombre: "xl/styles.xml", datos: b(estilos) },
    { nombre: "xl/worksheets/sheet1.xml", datos: b(hoja) },
  ]);
}
