# Solicitud a la OFITIC — tres registros DNS

## Léeme antes de enviar

**Lo que se pide NO es crear un correo.** Es agregar tres entradas de texto en el
DNS. Si lo planteas como "necesito una cuenta nueva", es probable que lo rechacen
o lo escalen innecesariamente. El mensaje de abajo ya está redactado para evitar
ese malentendido: lo dice explícitamente en el primer párrafo.

**Puntos clave, por si te preguntan en persona:**

- No se crea ningún buzón. `labs.unimilitar.edu.co` es un subdominio, no una
  dirección de correo. Nadie recibe mensajes ahí.
- **No se toca `unimilitar.edu.co` ni Google Workspace.** Los registros van en un
  subdominio separado. El SPF y el DKIM del dominio principal quedan intactos, y
  el correo institucional sigue funcionando exactamente igual.
- Es una tarea de pocos minutos para quien administre la zona DNS.
- Si prefieren otro nombre de subdominio, se puede cambiar sin problema: solo hay
  que regenerar los valores en Resend y avisarme.

---

## Mensaje para enviar

> **Asunto:** Solicitud de tres registros DNS en subdominio `labs.unimilitar.edu.co` — División de Laboratorios
>
> Cordial saludo.
>
> Escribo desde la División de Laboratorios. Estamos poniendo en marcha la
> plataforma de reserva de prácticas de laboratorio, que necesita enviar correos
> automáticos a estudiantes y laboratoristas (confirmación de solicitud,
> aprobación o rechazo, y aviso de solicitudes nuevas).
>
> **Aclaro de entrada el alcance de la solicitud: no se requiere crear ninguna
> cuenta ni buzón de correo, ni modificar la configuración del correo
> institucional.** Se trata únicamente de publicar tres registros DNS en un
> subdominio nuevo, para que el proveedor de envío pueda acreditar que está
> autorizado a enviar en nombre de ese subdominio. Sin esos registros, los
> mensajes son rechazados o marcados como spam por los servidores destinatarios.
>
> **Registros solicitados, en la zona `labs.unimilitar.edu.co`:**
>
> **1. DKIM — firma criptográfica de los mensajes**
>
> - Tipo: `TXT`
> - Nombre: `resend._domainkey.labs`
> - TTL: automático
> - Valor:
>
> ```
> p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDdm9p0iNKlZsgit/P5OjBym0PoUT6/WAhGPW7+Q9KjN+Du9RGnM+DE8ZbHdNOqgUwJqBNJHK8IWerVp2v3yfeG/RscjTO5ddzZRXa1DrzM4zj8Jsdl6MmD9IVsrjErjZ/R4vZYDZJaRRZpb5pySNBGriVQF60Yfh2lPXCHaA+WIQIDAQAB
> ```
>
> **2. MX — gestión de rebotes**
>
> - Tipo: `MX`
> - Nombre: `send.labs`
> - TTL: automático
> - Valor (incluye la prioridad y el punto final):
>
> ```
> 10 feedback-smtp.sa-east-1.amazonses.com.
> ```
>
> En Amazon Route 53 la prioridad va dentro del campo de valor, por lo que la
> línea se pega completa. Si la herramienta la pide aparte, corresponde `10` y el
> servidor `feedback-smtp.sa-east-1.amazonses.com.`
>
> **3. SPF — autorización de envío**
>
> - Tipo: `TXT`
> - Nombre: `send.labs`
> - TTL: automático
> - Valor:
>
> ```
> v=spf1 include:amazonses.com ~all
> ```
>
> ---
>
> **Por qué no afecta al correo institucional**
>
> Entiendo que el correo de la Universidad opera sobre Google Workspace. Los tres
> registros anteriores se publican en el subdominio `labs.unimilitar.edu.co` y
> **no modifican ningún registro existente de `unimilitar.edu.co`**: el SPF y el
> DKIM del dominio principal, así como los registros MX que dirigen el correo
> hacia Google, permanecen sin cambios.
>
> El uso de un subdominio dedicado es deliberado y es la práctica recomendada
> para correo transaccional: aísla la reputación de envío, de modo que cualquier
> incidencia con estos mensajes automáticos no puede afectar la entregabilidad
> del correo institucional.
>
> **Qué hace cada registro**
>
> - **DKIM**: publica una clave pública que permite a los servidores
>   destinatarios verificar que los mensajes no fueron alterados en tránsito y
>   provienen de un emisor autorizado. Previene suplantación.
> - **SPF**: declara qué servidores pueden enviar en nombre del subdominio.
> - **MX**: dirige los rebotes (direcciones inexistentes, buzones llenos) para
>   poder depurarlos.
>
> No se solicita el registro de rastreo de clics que ofrece el proveedor: se
> desactivó a propósito para no reescribir los enlaces de los correos ni
> recolectar datos de comportamiento de los estudiantes.
>
> **Otros datos**
>
> - Proveedor de envío: Resend (resend.com), región São Paulo.
> - Volumen estimado: unos pocos cientos de mensajes al mes en fase piloto.
> - Si prefieren un nombre de subdominio distinto, puedo regenerar los valores
>   sin inconveniente.
>
> Quedo atento a lo que requieran, incluidas las revisiones de seguridad que
> consideren pertinentes.
>
> Cordialmente,
>
> Juan Sebastian Vargas Borda
> División de Laboratorios
> juans.vargas@unimilitar.edu.co

---

## Cuando confirmen la publicación

1. En [resend.com/domains](https://resend.com/domains), abre
   `labs.unimilitar.edu.co` y presiona **"I've already added the records"**.
   El estado pasa de *Not Started* a *Pending* y luego a **Verified**. La
   propagación tarda entre minutos y unas horas.
2. Con el dominio verificado, agrega la variable en `.env.local` **y en Vercel**:

```
EMAIL_FROM=Laboratorios UMNG <laboratorios@labs.unimilitar.edu.co>
```

3. Vuelve a desplegar y confirma con **Enviar prueba** desde `/dashboard`.

Esa dirección `laboratorios@labs.unimilitar.edu.co` **no necesita existir como
buzón**: es solo el remitente visible.
