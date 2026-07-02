import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--umng-surface)" }}
    >
      <LoginForm />
    </div>
  );
}
