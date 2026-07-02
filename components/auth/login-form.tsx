// components/auth/login-form.tsx — tarjeta de acceso con identidad UMNG
"use client";

import { useState } from "react";
import { signIn, signUp } from "@/app/(auth)/actions";

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "registro">("login");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handle(formData: FormData) {
    setError(null);
    setPending(true);
    const action = mode === "login" ? signIn : signUp;
    const result = await action(formData); // en éxito hace redirect y no retorna
    setPending(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--umng-border)] bg-white shadow-sm">
      {/* Cabecera institucional (navy) */}
      <div className="bg-[var(--umng-navy)] px-8 py-6 text-white">
        <p className="font-data text-xs uppercase tracking-[0.2em] text-[var(--umng-gold)]">
          Universidad Militar Nueva Granada
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          Reserva de Laboratorios
        </h1>
      </div>

      <form action={handle} className="space-y-4 px-8 py-8">
        {mode === "registro" && (
          <Field label="Nombre completo" name="full_name" type="text" required />
        )}
        <Field
          label="Correo institucional"
          name="email"
          type="email"
          placeholder="usuario@unimilitar.edu.co"
          pattern="[a-zA-Z0-9._%+\-]+@unimilitar\.edu\.co"
          title="Usa tu correo @unimilitar.edu.co"
          required
        />
        <Field label="Contraseña" name="password" type="password" minLength={8} required />

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-[var(--umng-crimson)]/30 bg-[var(--umng-crimson)]/5 px-3 py-2 text-sm text-[var(--umng-crimson)]"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-[var(--umng-crimson)] px-4 py-2.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? "Procesando…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "registro" : "login");
            setError(null);
          }}
          className="w-full text-center text-sm text-[var(--umng-navy)] underline-offset-4 hover:underline"
        >
          {mode === "login"
            ? "¿No tienes cuenta? Regístrate"
            : "¿Ya tienes cuenta? Inicia sesión"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--umng-ink)]">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-lg border border-[var(--umng-border)] px-3 py-2 text-[var(--umng-ink)] outline-none transition focus-visible:border-[var(--umng-navy)] focus-visible:ring-2 focus-visible:ring-[var(--umng-navy)]/20"
      />
    </label>
  );
}
