# Configuración de correos (Resend)

## Lo que hay que entender primero

El código **no está roto**: está diseñado para funcionar sin correo y avisar en
vez de fallar. Lo que falta es la configuración, y ahí hay una restricción de
Resend que conviene conocer antes de empezar.

> **Sin un dominio verificado, Resend solo permite enviar desde
> `onboarding@resend.dev` y ÚNICAMENTE a la dirección con la que creaste la
> cuenta.** Es un modo de pruebas anti-abuso.

Traducido: con solo crear la cuenta y pegar la clave, **podrás probar** que el
sistema envía, pero **los correos a estudiantes y laboratoristas no llegarán**.
Para eso hace falta verificar un dominio, y eso son registros DNS.

Por eso esto va en dos etapas.

---

## Etapa 1 — Que funcione para pruebas (15 minutos, lo haces solo)

1. Crea una cuenta en [resend.com](https://resend.com). **Regístrate con tu
   correo institucional** `@unimilitar.edu.co`: en modo de pruebas es la única
   dirección a la que podrás enviar.
2. En **API Keys → Create API Key**, dale permiso de envío y copia la clave
   (empieza por `re_`). Solo se muestra una vez.
3. Agrégala a `.env.local`:

```
RESEND_API_KEY=re_tu_clave_aqui
```

No definas `EMAIL_FROM` todavía: sin dominio verificado, el remitente debe
seguir siendo `onboarding@resend.dev`, que es el valor por defecto del código.

4. Reinicia el servidor y entra a `/dashboard`. Arriba verás el recuadro
   **"Envío de correos"**. Dale **Enviar prueba**: te llega un correo a tu
   propia dirección.

Con esto confirmas que la clave, la librería y las plantillas funcionan.

---

## Etapa 2 — Que llegue a todo el mundo (requiere la OFITIC)

Para enviar a cualquier `@unimilitar.edu.co` hay que verificar un dominio en
Resend. Se hace agregando registros DNS, y esos los controla la OFITIC.

**Lo que debes pedirles.** En Resend, **Domains → Add Domain**, escribe el
dominio o subdominio (recomendado algo como `labs.unimilitar.edu.co`, para no
tocar el correo institucional principal). Resend te mostrará tres registros:

| Tipo | Para qué |
|---|---|
| `MX` | recepción del subdominio |
| `TXT` (SPF) | autoriza a Resend a enviar en nombre del dominio |
| `TXT` (DKIM) | firma criptográfica de los mensajes |

Envía esos valores a la OFITIC pidiendo que los agreguen. Cuando estén
publicados, Resend marca el dominio como *Verified*.

**Usar un subdominio dedicado no es capricho:** si algo sale mal con la
reputación de envío, el impacto queda acotado y no afecta al correo institucional.

Una vez verificado, agrega la variable del remitente:

```
EMAIL_FROM=Laboratorios UMNG <laboratorios@labs.unimilitar.edu.co>
```

Vuelve a desplegar y usa otra vez **Enviar prueba** desde el panel.

---

## Qué correos envía la plataforma

| Cuándo | A quién | Contenido |
|---|---|---|
| El estudiante envía la solicitud | Al estudiante **y a cada integrante del grupo** | Confirmación, franjas y su código |
| El estudiante envía la solicitud | **Al laboratorista del lab** | Solicitudes nuevas por revisar + enlace al panel |
| El laboratorista decide | Al estudiante | Aprobada (con recordatorio del carné) o rechazada con motivo |

El aviso a los integrantes del grupo no es cortesía: es la contrapartida de que
una persona registre los datos de sus compañeros, y les permite cancelar su cupo.

---

## Si algo falla

**Nada llega y el panel dice "Sin configurar"** → falta `RESEND_API_KEY`. En
Vercel, recuerda que tras agregar una variable hay que **volver a desplegar**.

**Llega a tu correo pero no a los demás** → estás en modo de pruebas. Es la
Etapa 2: falta verificar el dominio.

**Resend responde error de dominio** → `EMAIL_FROM` usa un dominio que no está
verificado. Quita esa variable para volver a `onboarding@resend.dev` mientras se
resuelve.

**Una reserva se creó pero no llegó el correo** → es el comportamiento previsto.
El envío es *best-effort*: si el correo falla, la reserva sigue siendo válida.
El fallo queda en los registros del servidor (en Vercel: pestaña **Logs**).
