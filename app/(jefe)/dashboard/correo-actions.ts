// app/(jefe)/dashboard/correo-actions.ts — diagnóstico del envío de correos.
// Permite al jefe comprobar la configuración de Resend sin tener que crear una
// reserva de prueba ni revisar los registros del servidor.
"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/supabase/roles";
import { enviarCorreo, remitenteActual } from "@/lib/email/resend";

export type PruebaCorreoResult =
  | { ok: true; destino: string; remitente: string }
  | { ok: false; error: string };

export async function enviarCorreoDePrueba(): Promise<PruebaCorreoResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado." };

  const role = await getUserRole(supabase, user.id);
  if (role !== "jefe") {
    return { ok: false, error: "Solo el jefe puede enviar correos de prueba." };
  }
  if (!user.email) {
    return { ok: false, error: "Tu cuenta no tiene correo asociado." };
  }

  const res = await enviarCorreo({
    para: user.email,
    asunto: "Prueba de correo · Reserva de Laboratorios UMNG",
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;padding:24px;color:#0F1B2D;">
        <h2 style="color:#0B254E;margin:0 0 12px;">El correo está funcionando</h2>
        <p style="font-size:14px;line-height:1.6;">
          Si estás leyendo esto, la plataforma puede enviar correos: los estudiantes
          recibirán la confirmación de su solicitud y el aviso de aprobación, y los
          laboratoristas serán notificados de las solicitudes nuevas.
        </p>
        <p style="font-size:12px;color:#5B6472;margin-top:20px;">
          Mensaje de prueba enviado desde el panel de control.
          Remitente: ${remitenteActual()}
        </p>
      </div>`,
  });

  if (res.enviado) {
    return { ok: true, destino: user.email, remitente: remitenteActual() };
  }
  if (res.motivo === "sin_configurar") {
    return {
      ok: false,
      error:
        "Falta la variable RESEND_API_KEY. Configúrala en Vercel (o en .env.local) y vuelve a desplegar.",
    };
  }
  // Se incluye el destinatario en el mensaje: el error más frecuente en esta
  // etapa es que Resend, sin dominio verificado, solo acepta como destinatario
  // la dirección con la que se creó la cuenta. Sin ver a qué correo se intentó
  // enviar, el mensaje de Resend resulta desconcertante.
  return {
    ok: false,
    error: `Se intentó enviar a ${user.email} desde ${remitenteActual()}. ${
      res.detalle ??
      "Resend rechazó el envío. Lo más común: el dominio del remitente no está verificado."
    }`,
  };
}
