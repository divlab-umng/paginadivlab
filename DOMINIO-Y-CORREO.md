# Dominio propio y correo transaccional

> ## ✅ ESTADO: EN PRODUCCIÓN (agosto de 2026)
>
> | | |
> |---|---|
> | **Dominio** | `innovalaboratories.org` — comprado en **Cloudflare Registrar** |
> | **Subdominio de envío** | `labs.innovalaboratories.org` |
> | **Región** | São Paulo (`sa-east-1`) |
> | **Estado en Resend** | **Verified** — DKIM, SPF y MX autenticados |
> | **DNS** | Cloudflare, configurado con *Auto configure* |
> | **Remitente** | `Laboratorios UMNG <laboratorios@labs.innovalaboratories.org>` |
> | **DMARC** | ⚠️ **pendiente** — ver Paso 5 |
>
> Los pasos 1 a 5 de esta guía **ya están hechos**. Se conservan como referencia
> para reproducir el montaje o migrarlo al dominio institucional más adelante.
>
> **Lo que queda pendiente:** definir `EMAIL_FROM` y `RESEND_API_KEY` en las
> variables de entorno de **Vercel** (en `.env.local` ya están) y verificar el
> envío desde producción.

Orden cronológico. Cada paso supone el anterior terminado.

---

## Decisiones tomadas y por qué

### Proveedor: Resend

| Proveedor | Plan gratuito (2026) | Veredicto |
|---|---|---|
| **Resend** | 3.000/mes · 100/día | **Elegido.** Ya integrado y probado |
| SendGrid | Eliminado; 60 días de prueba | Descartado |
| Postmark | 100/mes, solo desarrollo | Insuficiente |
| AWS SES | 3.000/mes, pero sale del *sandbox* con solicitud manual | Complejidad innecesaria |

Con ~3 laboratorios y unas decenas de reservas semanales, el plan gratuito sobra.
El límite que suele apretar es el de **100 al día**, no el mensual.

### TLD: `.co` o `.com`, **no** `.xyz` ni `.lab`

Los TLD ultrabaratos (`.xyz`, `.top`, `.click`) arrastran mala reputación por su
uso masivo en spam. Los filtros los penalizan **por el TLD**, sin importar cuán
bien configures SPF y DKIM. Ahorrarte quince mil pesos aquí destruye justo lo
que intentas lograr.

`.co` es el TLD de Colombia y `.org` transmite institucionalidad: ambos se ven
legítimos y cuestan poco. **Se eligió `innovalaboratories.org`.**

### Sin Edge Functions

La aplicación ya envía desde **Server Actions de Next.js**, que corren en el
servidor: la clave nunca llega al navegador. Interponer una Edge Function
añadiría un salto de red, otro despliegue, otro almacén de secretos y código
duplicado, sin ganar nada.

> **Cuándo sí valdría la pena:** si los correos tuvieran que dispararse desde
> *eventos de base de datos* (un trigger de Postgres, con `pg_net`) de forma
> independiente de la aplicación, o si varios clientes distintos necesitaran la
> misma lógica de envío. Ninguno es el caso aquí.

---

## Paso 1 — Comprar el dominio ✅ hecho

> **Hecho:** `innovalaboratories.org` en Cloudflare Registrar.

### Recomendado: Cloudflare Registrar

Vende **al costo, sin margen**, y el precio de renovación es el mismo que el de
registro. Namecheap tiene el primer año barato (~3,50 USD para `.co`) pero
**renueva cerca de 27 USD al año**. A dos años ya salió más caro.

Además te ahorra el Paso 2 completo: registras y administras el DNS en el mismo
lugar, sin cambiar nameservers.

1. Entra a [dash.cloudflare.com](https://dash.cloudflare.com) y crea la cuenta
   **usando tu correo institucional**.
2. **Domain Registration → Register Domain**, busca el nombre y elige `.co`.
3. Activa la **renovación automática** y, si puedes, paga **dos o tres años**.
   Un dominio vencido deja la plataforma sin correos de un día para otro.
4. La privacidad del Whois viene incluida sin costo.

### Alternativa: Namecheap

Si prefieres Namecheap, en el carrito **desactiva** hosting, correo y SSL —
Cloudflare y Vercel los cubren gratis— y deja activo WhoisGuard. Luego completa
el Paso 2. Y **verifica el correo del registrador**: si no lo confirmas en 15
días, el dominio se suspende.

---

## Paso 2 — Apuntar Namecheap a Cloudflare ⏭️ no aplicó

> Se compró en Cloudflare Registrar, así que el dominio ya estaba en Cloudflare.
> Este paso solo aplica si el dominio se registra en otro proveedor.

1. En [cloudflare.com](https://dash.cloudflare.com) → **Add a site** → escribe tu
   dominio → plan **Free**.
2. Cloudflare escanea los registros existentes y te mostrará **dos nameservers**:

```
gina.ns.cloudflare.com
rick.ns.cloudflare.com
```

3. En Namecheap: **Domain List → Manage** → sección **NAMESERVERS** → cambia de
   *Namecheap BasicDNS* a **Custom DNS** → pega los dos → guarda con el ✓.
4. Vuelve a Cloudflare y presiona **Check nameservers**.

La propagación tarda entre minutos y 24 horas. **No sigas hasta ver el estado
Active.**

---

## Paso 3 — Agregar el dominio en Resend ✅ hecho

> **Hecho:** `labs.innovalaboratories.org`, región São Paulo.

1. En [resend.com/domains](https://resend.com/domains) → **Add Domain**.
2. Nombre: usa un **subdominio**, no el dominio raíz. Por ejemplo:

```
labs.innovalaboratories.org
```

   Un subdominio dedicado aísla la reputación de envío: si algo sale mal con los
   correos automáticos, no arrastra al dominio principal.
3. Región: **São Paulo (sa-east-1)** — la más cercana a Colombia.
4. En **Advanced options**, desactiva **Enable click tracking** y
   **Enable open tracking**. Evitan reescribir enlaces y recolectar datos de
   comportamiento de los estudiantes, y ahorran un registro DNS.
5. **Add domain**. Resend mostrará los registros.

---

## Paso 4 — Crear los registros en Cloudflare ✅ hecho (automático)

> **Se hizo con el botón "Auto configure" de Resend.** Lo de abajo aplica solo
> si algún día toca hacerlo a mano o en otro proveedor de DNS.

En Cloudflare → tu dominio → **DNS → Records → Add record**.

> ⚠️ **Particularidad de Cloudflare:** al crear registros, algunos aparecen con
> la nube naranja (*Proxied*). Los de correo **deben ir en gris (DNS only)**. Los
> TXT y MX no admiten proxy, pero verifícalo: un registro proxiado rompe la
> verificación de forma silenciosa.
>
> **Y algo que se olvida siempre:** en el campo *Name*, Cloudflare **agrega el
> dominio automáticamente**. Si Resend dice `resend._domainkey.labs`, escribe
> exactamente eso — **no** `resend._domainkey.labs.tudominio.co`, o quedará
> duplicado y no verificará.

### 4.1 DKIM — firma de los mensajes

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Name | `resend._domainkey.labs` |
| Content | la cadena que empieza por `p=` (cópiala **completa** desde Resend) |
| TTL | Auto |
| Proxy | DNS only |

### 4.2 SPF — quién puede enviar

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Name | `send.labs` |
| Content | `v=spf1 include:amazonses.com ~all` |
| TTL | Auto |

### 4.3 MX — rebotes

| Campo | Valor |
|---|---|
| Type | `MX` |
| Name | `send.labs` |
| Mail server | `feedback-smtp.sa-east-1.amazonses.com` |
| Priority | `10` |
| TTL | Auto |

> Cloudflare pide la prioridad en un campo aparte. El punto final del nombre lo
> agrega solo.

### 4.4 DMARC — política y visibilidad

Este **no lo pide Resend**, pero deberías agregarlo: les dice a los servidores
receptores qué hacer si un mensaje falla la autenticación, y mejora la
entregabilidad de forma notable.

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Name | `_dmarc.labs` |
| Content | `v=DMARC1; p=none; rua=mailto:juans.vargas@unimilitar.edu.co; pct=100; adkim=r; aspf=r` |
| TTL | Auto |

**Empieza con `p=none`**, que solo observa y reporta sin bloquear nada. Después
de unas semanas sin incidencias, endurécelo a `p=quarantine`. Poner `p=reject`
de entrada puede tumbar correos legítimos mientras la configuración se asienta.

---

## Paso 5 — Verificar en Resend ✅ hecho

> **Resultado real:** dominio añadido y verificado en 7 minutos usando
> **Auto configure**, la integración de Resend con Cloudflare que publica los
> registros sola. Si el DNS está en Cloudflare, ese botón evita todo el trabajo
> manual del Paso 4.
>
### Estado real de los registros (consultado en el DNS, agosto 2026)

| Registro | Nombre completo | Estado |
|---|---|---|
| DKIM | `resend._domainkey.labs.innovalaboratories.org` | ✅ publicado |
| SPF | `send.labs.innovalaboratories.org` (TXT) | ✅ publicado |
| MX | `send.labs.innovalaboratories.org` | ✅ publicado |
| **DMARC** | `_dmarc.labs.innovalaboratories.org` | ❌ **NO existe** |

Los tres registros que Resend exige están activos y el dominio quedó *Verified*.
**El DMARC no.** En el panel de Resend aparece bajo *DMARC (Optional)* y con la
columna **Status vacía**: es una recomendación que muestra, no algo que Auto
configure haya creado. Una consulta al DNS lo confirma — no responde ni en el
subdominio ni en la raíz del dominio.

### Pendiente: crear el DMARC a mano

No bloquea el envío, pero sin él los servidores receptores no saben qué hacer con
un mensaje que falle la autenticación, y la entregabilidad sufre. Gmail y Outlook
lo tienen cada vez más en cuenta.

En Cloudflare → `innovalaboratories.org` → **DNS → Records → Add record**:

| Campo | Valor |
|---|---|
| Type | `TXT` |
| Name | `_dmarc.labs` |
| Content | `v=DMARC1; p=none; rua=mailto:juans.vargas@unimilitar.edu.co` |
| TTL | Auto |
| Proxy | DNS only |

El `rua=` hace que lleguen informes agregados de quién envía en nombre del
dominio: es la única forma de detectar suplantación a tiempo. **Deja `p=none`**
las primeras semanas, que solo observa; después endurécelo a `p=quarantine`.

Para comprobar que quedó publicado:
`https://dns.google/resolve?name=_dmarc.labs.innovalaboratories.org&type=TXT`

### Rastreo de clics

Auto configure creó el CNAME `links.labs`. Habíamos desactivado el rastreo a
propósito, para no reescribir los enlaces de los correos ni recolectar datos de
comportamiento de los estudiantes — decisión que además quedó escrita en la
política de tratamiento de datos. **Confirma en Domains → Configuration que
*Click tracking* y *Open tracking* siguen apagados.** El registro DNS puede
quedarse; lo que importa es el interruptor.

1. En Resend → **Domains** → tu dominio → **I've already added the records**.
2. Con Cloudflare la propagación suele tomar **minutos**, no horas.
3. El estado debe pasar a **Verified**, con los tres registros en verde.

Si alguno queda en rojo, revisa en este orden: nombre duplicado (el error más
común), nube naranja activada, o cadena DKIM cortada al copiar.

---

## Paso 6 — Configurar la aplicación ✅ hecho en local

En `.env.local` **y en las variables de entorno de Vercel**:

```
RESEND_API_KEY=re_tu_clave
EMAIL_FROM="Laboratorios UMNG <laboratorios@labs.innovalaboratories.org>"
```

La dirección `laboratorios@...` **no necesita existir como buzón**: es solo el
remitente visible. Los rebotes los recoge el registro MX.

> **El remitente vive en un solo lugar:** `lib/email/resend.ts`. Los tres correos
> pasan por `enviarCorreo`, así que ninguna Server Action lo define por su
> cuenta. Si algún día hay que cambiarlo, se cambia ahí (o vía `EMAIL_FROM`).
>
> El valor **por defecto en el código ya es el dominio verificado**, no el de
> pruebas. Así, si alguien olvida definir `EMAIL_FROM` en Vercel, los correos
> siguen saliendo bien en vez de fallar en silencio llegando solo al dueño de la
> cuenta de Resend.

> Las variables se leen al construir. Tras cambiarlas en Vercel hay que
> **volver a desplegar** para que tengan efecto.

---

## Paso 7 — Comprobar antes de enviar de verdad

- [ ] Cloudflare muestra el dominio como **Active**
- [ ] Resend muestra el dominio como **Verified**
- [ ] Los cuatro registros existen y ninguno está proxiado (nube gris)
- [ ] `EMAIL_FROM` usa el subdominio verificado, no `resend.dev`
- [ ] En `/dashboard`, **Enviar prueba** llega a tu bandeja
- [ ] Prueba enviando **a un correo distinto del tuyo** (una cuenta personal):
      esto confirma que ya saliste del modo de pruebas
- [ ] El correo llega a **Recibidos**, no a spam
- [ ] En Gmail: abrir el mensaje → ⋮ → **Mostrar original** → debe decir
      `SPF: PASS` y `DKIM: PASS`. **`DMARC` dirá `PASS` solo cuando se cree el
      registro** (ver Paso 5); mientras tanto puede aparecer vacío o en `NONE`,
      lo que no impide la entrega pero sí resta reputación.
- [ ] Al crear una reserva, **solo el laboratorista** recibe correo
- [ ] Al presionar **Aprobar**, el estudiante recibe el correo con laboratorio,
      fecha, hora e instrucciones de ingreso
- [ ] Al presionar **Rechazar**, el estudiante recibe el correo con el motivo
- [ ] Con instrucciones propias guardadas en `/panel/horarios`, el correo de
      aprobación las muestra en vez de las genéricas
- [ ] En Resend → **Logs**, los envíos aparecen como *Delivered*

El paso de **Mostrar original** es el que de verdad confirma que la
autenticación quedó bien. Los otros pueden pasar por casualidad.

---

## Flujo de correos (definido con la División, agosto 2026)

El estudiante recibe **un solo correo en todo el proceso**: el de aprobación.

| Momento | Estado | Quién recibe correo |
|---|---|---|
| El estudiante envía la solicitud | `pendiente` | **Solo el laboratorista** del lab, con el detalle y un botón al panel |
| El laboratorista presiona **Aprobar** | `aprobada` | **El estudiante**, con todo lo necesario para presentarse |
| El laboratorista presiona **Rechazar** | `rechazada` | **El estudiante**, con el motivo y un enlace para pedir otra franja |

**Por qué el laboratorista recibe aviso al crearse la solicitud:** es lo que
dispara todo lo demás. Sin ese mensaje tendría que entrar al panel "por si
acaso", y si no entra, la aprobación nunca ocurre.

**Por qué también se avisan los rechazos:** sin ese correo el estudiante queda
esperando indefinidamente una aprobación que no va a llegar, y pierde la
oportunidad de buscar otra franja a tiempo.

**Al crear la solicitud el estudiante no recibe nada**, porque ya vio la
confirmación en pantalla. Ahí mismo se le indica que consulte su estado en
`/consulta` si quiere seguirlo antes de la decisión.

### Qué lleva el correo de aprobación

Está en `correoPracticaAprobada` (`lib/email/templates.ts`):

- Nombre del estudiante
- **Laboratorio asignado**
- **Fecha y hora** aprobadas, en formato largo
- Materia y código de estudiante
- Integrantes del grupo, cuando la práctica es en equipo
- **Instrucciones de ingreso** (ver abajo)
- Enlace para cancelar y liberar el cupo

### Instrucciones de ingreso por laboratorio

Cada laboratorista escribe las suyas desde **`/panel/horarios` → Instrucciones de
ingreso**, una por línea. Se guardan en `laboratories.safety_notes` (migración
`0022`) y salen como lista en el correo de aprobación.

No es lo mismo entrar a Metales que a CIM: uno exige gafas y no llevar manga
suelta cerca del torno; el otro, no tocar las celdas en movimiento. Un texto
genérico igual para todos termina ignorándose justo porque no dice nada concreto.
Quien sabe qué advertir es el laboratorista, no quien programa.

**Si un laboratorio no define las suyas**, el correo usa las instrucciones
generales: llegar 10 minutos antes, traer el carné (se escanea), calzado cerrado
y elementos de protección, sin alimentos ni bebidas, y seguir las indicaciones
del laboratorista.

> ⚠️ **Ese texto lo escribe una persona y termina dentro de un correo HTML.**
> La función `escapar` de `lib/email/templates.ts` lo neutraliza antes de
> insertarlo: sin ella, un `&` en "gafas & guantes" o un `<` en "temperatura <
> 40°" romperían la maqueta, y una etiqueta pegada por accidente se
> interpretaría como HTML. **No quitar ese escapado.**

### Dónde vive cada envío

- `app/(publico)/reservar/actions.ts` → aviso al laboratorista al crear.
- `app/(laboratorista)/panel/actions.ts` → correo de aprobación, dentro de
  `decideReservation`, **condicionado a `if (approve)`**. El mismo Server Action
  actualiza el estado en Supabase mediante el RPC `decide_reservation` y luego
  dispara el correo.

---

## Manejo de errores y reintentos (ya implementado)

En `lib/email/resend.ts`:

- **Nunca lanza excepciones.** Un fallo de correo no puede tumbar una reserva.
- **Reintenta hasta 3 veces** con espera creciente (400 ms, 800 ms) solo ante
  fallos **transitorios**: cortes de red, límite de tasa (429), errores 5xx.
- **No reintenta** fallos definitivos —clave inválida, dominio sin verificar,
  destinatario no permitido—, porque insistir no los arregla y solo retrasa la
  respuesta al usuario.
- **Deja rastro** en los registros del servidor (en Vercel: pestaña *Logs*).
- El panel del jefe muestra el estado y permite enviar un correo de prueba.

---

## Extra — usar el mismo dominio para la aplicación

Ya que compras el dominio, puedes servir la aplicación desde él en vez de
`algo.vercel.app`:

1. En Vercel → tu proyecto → **Settings → Domains** → agrega
   `reservas.innovalaboratories.org`.
2. Vercel te dará un `CNAME`. Créalo en Cloudflare **con la nube gris
   (DNS only)** — si lo proxias, Vercel no puede emitir el certificado.
3. Actualiza `NEXT_PUBLIC_SITE_URL` con la nueva URL y vuelve a desplegar.

Da una dirección más presentable para compartir con estudiantes, y el HTTPS
sigue siendo automático.

---

## Sobre el dominio institucional

Esto resuelve el problema hoy y sin depender de nadie, pero **es un puente, no
el destino**. Un correo que llega desde `labs.innovalaboratories.org` para una
plataforma oficial de la Universidad genera desconfianza razonable en el
estudiante.

Cuando la OFITIC publique los registros en `labs.unimilitar.edu.co`, migrar es
trivial: agregas ese dominio en Resend, cambias `EMAIL_FROM` y vuelves a
desplegar. Nada más. Vale la pena mantener la solicitud viva en paralelo.
