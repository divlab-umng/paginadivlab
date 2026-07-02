import { RegisterForm } from "@/components/auth/register-form";

export default function RegistroPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--umng-surface)" }}
    >
      <RegisterForm />
    </div>
  );
}
