// app/(auth)/registro-personal/page.tsx — alta de laboratoristas y jefatura.
// Los estudiantes NO se registran: reservan sin cuenta en /reservar.
import { StaffRegisterForm } from "@/components/auth/staff-register-form";

export const metadata = {
  title: "Registro de personal · UMNG",
  description:
    "Solicitud de acceso para laboratoristas y jefatura de la División de Laboratorios.",
};

export default function RegistroPersonalPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ background: "var(--umng-surface)" }}
    >
      <StaffRegisterForm />
    </div>
  );
}
