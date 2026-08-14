// app/(publico)/consulta/page.tsx — seguimiento de reservas sin cuenta
import Link from "next/link";
import { ConsultaReservas } from "@/components/publico/consulta-reservas";

export const metadata = {
  title: "Consultar mis reservas · UMNG",
  description:
    "Consulta el estado de tus prácticas de laboratorio con tu código de estudiante y tu correo institucional.",
};

export default function ConsultaPage() {
  return (
    <div className="bg-[var(--umng-navy-50)]">
      <section className="hero-umng">
        <div className="mx-auto max-w-3xl px-5 py-10 text-center">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-[var(--umng-gold)]">
            Seguimiento
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">
            Mis reservas
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/80">
            Consulta el estado de tus prácticas y cancélalas si ya no puedes
            asistir. Sin contraseña.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-2xl px-5 pb-20 -mt-6">
        <ConsultaReservas />

        <p className="mt-6 text-center text-sm text-[var(--umng-muted)]">
          ¿Aún no has reservado?{" "}
          <Link
            href="/reservar"
            className="font-semibold text-[var(--umng-navy)] underline-offset-4 hover:underline"
          >
            Reserva tu práctica
          </Link>
        </p>
      </section>
    </div>
  );
}
