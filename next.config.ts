import type { NextConfig } from "next";

/**
 * Orígenes permitidos en DESARROLLO.
 *
 * Next.js 16 bloquea las peticiones a /_next/* cuando el servidor de desarrollo
 * se abre desde un origen distinto de localhost (protección contra que un sitio
 * cualquiera lea tu servidor local). El síntoma es engañoso: la página CARGA
 * —porque el HTML viene del servidor— pero el JavaScript no, así que nada
 * responde: los botones no hacen nada y no aparece ningún error en pantalla.
 *
 * Esto solo aplica a `next dev`. En producción (Vercel) no interviene.
 *
 * Para probar desde el celular hay que listar aquí la IP del computador.
 * Si tu IP cambia (típico en hotspot o al cambiar de red), NO edites este
 * archivo: agrega la nueva a `.env.local` y reinicia el servidor:
 *
 *     DEV_ORIGINS=192.168.1.20,10.0.0.5
 *
 * La IP se consulta con `ipconfig` (Windows) → "Dirección IPv4".
 */
const origenesExtra =
  process.env.DEV_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "10.200.212.211", // IP usada en las pruebas desde el celular
    ...origenesExtra,
  ],
};

export default nextConfig;
