// components/auth/staff-register-form.tsx
// Alta de personal (laboratoristas y jefatura).
// Registrarse NO da acceso: la cuenta queda pendiente hasta que el jefe le
// asigne rol y laboratorios. Eso se dice explícitamente en la interfaz para
// que nadie se quede esperando poder entrar.
"use client";

import { useState } from "react";
import Link from "next/link";
import { signUpStaff } from "@/app/(auth)/actions";

export function StaffRegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [listo, setListo] = useState(false);

  async function handle(formData: FormData) {
    setError(null);
    setPending(true);
    const result = await signUpStaff(formData);
    setPending(false);
    if (result?.error) setError(result.error);
    else setListo(true);
  }

  if (listo) {
    return (
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--umng-border)] bg-white shadow-sm">
        <div
          className="px-8 py-6 text-white"
          style={{ background: "var(--umng-green)" }}
        >
          <h1 className="text-2xl font-semibold text-white">Solicitud enviada</h1>
        </div>
        <div className="space-y-4 px-8 py-8">
          <p className="text-sm text-[var(--umng-ink)]">
            Tu cuenta quedó creada, pero todavía <strong>no tiene acceso</strong>.
            La jefatura de la División de Laboratorios debe asignarte el rol y
            los laboratorios que administrarás.
          </p>
          <p className="text-sm text-[var(--umng-muted)]">
            Cuando te habiliten, entra con tu correo y contraseña desde el acceso
            del personal.
          </p>
          <Link href="/login" className="btn-primary inline-block text-center">
            Ir al inicio de sesión
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--umng-border)] bg-white shadow-sm">
      <div className="bg-[var(--umng-navy)] px-8 py-6 text-white">
        <p className="font-data text-xs uppercase tracking-[0.2em] text-[var(--umng-gold)]">
          Universidad Militar Nueva Granada
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          Registro de personal
        </h1>
        <p className="mt-1 text-sm text-white/70">
          Solo para laboratoristas y jefatura. Los estudiantes no necesitan cuenta.
        </p>
      </div>

      <form action={handle} className="space-y-4 px-8 py-8">
        <Field label="Nombre completo" name="full_name" type="text" required />
        <Field
          label="Correo institucional"
          name="email"
          type="email"
          placeholder="usuario@unimilitar.edu.co"
          pattern="[a-zA-Z0-9._%+\-]+@unimilitar\.edu\.co"
          title="Usa tu correo @unimilitar.edu.co"
          required
        />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          minLength={8}
          title="Mínimo 8 caracteres"
          required
        />

        <p className="rounded-lg bg-[var(--umng-surface)] px-3 py-2 text-xs text-[var(--umng-muted)]">
          Al registrarte no obtienes acceso de inmediato: la jefatura revisa la
          solicitud y te asigna los laboratorios que administrarás.
        </p>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-[var(--umng-crimson)]/30 bg-[var(--umng-crimson)]/5 px-3 py-2 text-sm text-[var(--umng-crimson)]"
          >
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? "Enviando…" : "Solicitar acceso"}
        </button>

        <Link
          href="/login"
          className="block text-center text-sm text-[var(--umng-navy)] underline-offset-4 hover:underline"
        >
          ¿Ya tienes cuenta? Inicia sesión
        </Link>
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
