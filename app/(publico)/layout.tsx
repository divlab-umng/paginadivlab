// app/(publico)/layout.tsx — cascarón de las páginas públicas (sin login)
// Barra institucional superior + acceso discreto para personal (laboratorista/jefe).
import Link from "next/link";

export default function PublicoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="umng-header">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-3">
          <Link href="/" className="flex flex-col leading-tight">
            <span className="font-data text-[0.7rem] uppercase tracking-[0.2em] text-[var(--umng-gold)]">
              Universidad Militar Nueva Granada
            </span>
            <span className="text-sm font-semibold text-white">
              Reserva de Laboratorios
            </span>
          </Link>
          <nav className="flex items-center gap-5">
            <Link
              href="/consulta"
              className="text-xs font-semibold text-white underline-offset-4 hover:underline"
            >
              Mis reservas
            </Link>
            <Link
              href="/login"
              className="text-xs font-medium text-white/70 underline-offset-4 hover:text-white hover:underline"
            >
              Acceso personal
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--umng-border)] py-4">
        <p className="mx-auto max-w-5xl px-5 text-xs text-[var(--umng-muted)]">
          UMNG · División de Laboratorios — Reserva de aforo para prácticas.
        </p>
      </footer>
    </div>
  );
}
