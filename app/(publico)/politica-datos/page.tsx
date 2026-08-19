// app/(publico)/politica-datos/page.tsx
// Política de tratamiento de datos personales (Ley 1581 de 2012, Decreto 1377
// de 2013 art. 13). Enlazada desde la casilla de autorización del formulario.
//
// ⚠️ BORRADOR TÉCNICO: este texto cubre los elementos que exige la norma, pero
// DEBE ser revisado y aprobado por el área de protección de datos de la UMNG
// antes de abrir la plataforma a estudiantes. No sustituye asesoría jurídica.
import Link from "next/link";
import {
  POLITICA_VERSION,
  POLITICA_VIGENCIA,
  RESPONSABLE,
} from "@/lib/politica-datos";

export const metadata = {
  title: "Política de tratamiento de datos · UMNG",
  description:
    "Política de tratamiento de datos personales de la plataforma de reserva de laboratorios.",
};

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-[var(--umng-navy)]">{titulo}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-[var(--umng-ink)]">
        {children}
      </div>
    </section>
  );
}

export default function PoliticaDatosPage() {
  return (
    <div className="bg-[var(--umng-navy-50)]">
      <section className="hero-umng">
        <div className="mx-auto max-w-3xl px-5 py-10">
          <p className="font-data text-xs uppercase tracking-[0.2em] text-[var(--umng-gold)]">
            Ley 1581 de 2012
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-white">
            Política de tratamiento de datos personales
          </h1>
          <p className="mt-2 font-data text-xs text-white/70">
            Versión {POLITICA_VERSION} · Vigente desde {POLITICA_VIGENCIA}
          </p>
        </div>
      </section>

      <article className="mx-auto max-w-3xl px-5 pb-20 -mt-6">
        <div className="card-elevated px-6 py-8 sm:px-10">
          <p className="text-sm leading-relaxed text-[var(--umng-muted)]">
            Esta política describe cómo la plataforma de reserva de laboratorios
            recolecta, usa y protege los datos personales de quienes solicitan
            prácticas, en cumplimiento de la Ley 1581 de 2012 y el Decreto 1377
            de 2013.
          </p>

          <Seccion titulo="1. Responsable del tratamiento">
            <p>
              <strong>{RESPONSABLE.nombre}</strong>
              <br />
              Correo para asuntos de datos personales:{" "}
              <a
                href={`mailto:${RESPONSABLE.correo}`}
                className="font-semibold text-[var(--umng-navy)] underline underline-offset-2"
              >
                {RESPONSABLE.correo}
              </a>
            </p>
          </Seccion>

          <Seccion titulo="2. Datos que se recolectan">
            <p>Al solicitar una práctica de laboratorio se recolecta:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Nombre completo</li>
              <li>Correo institucional</li>
              <li>Código estudiantil</li>
              <li>
                Materia, laboratorio, fecha y horario de la práctica solicitada
              </li>
              <li>
                Registro de asistencia, que puede tomarse escaneando el código de
                barras del carné estudiantil
              </li>
              <li>
                Cuando la práctica se solicita en grupo, la conformación del
                grupo de trabajo
              </li>
            </ul>
            <p>
              No se recolectan datos sensibles ni datos de menores de edad. La
              plataforma no solicita contraseña a los estudiantes.
            </p>
          </Seccion>

          <Seccion titulo="3. Finalidad">
            <p>Los datos se usan únicamente para:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Gestionar la solicitud, aprobación y control de aforo de las prácticas</li>
              <li>Verificar la identidad de quien ingresa al laboratorio y registrar su asistencia</li>
              <li>Comunicar por correo el estado de la solicitud</li>
              <li>
                Producir estadísticas de uso de los laboratorios para la
                planeación de recursos
              </li>
            </ul>
            <p>
              Los datos <strong>no se comparten con terceros</strong> con fines
              comerciales ni publicitarios.
            </p>
          </Seccion>

          <Seccion titulo="4. Prácticas solicitadas en grupo">
            <p>
              En algunos laboratorios los estudiantes trabajan en grupo y comparten
              un puesto de trabajo. Quien crea el grupo registra el nombre y el
              código de sus compañeros y{" "}
              <strong>declara contar con la autorización de cada uno</strong>.
            </p>
            <p>
              Para proteger a esas personas, cada integrante recibe un correo
              informándole que fue incluido en una solicitud, y puede cancelar su
              participación en cualquier momento desde la página de consulta, sin
              necesidad de cuenta.
            </p>
          </Seccion>

          <Seccion titulo="5. Derechos del titular">
            <p>
              Conforme al artículo 8 de la Ley 1581 de 2012, toda persona tiene
              derecho a:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Conocer, actualizar y rectificar sus datos personales</li>
              <li>Solicitar prueba de la autorización otorgada</li>
              <li>Ser informado sobre el uso que se ha dado a sus datos</li>
              <li>
                Presentar quejas ante la Superintendencia de Industria y Comercio
                por infracciones a la ley
              </li>
              <li>
                Revocar la autorización y solicitar la supresión de sus datos,
                cuando no exista un deber legal o contractual que lo impida
              </li>
              <li>Acceder gratuitamente a sus datos</li>
            </ul>
          </Seccion>

          <Seccion titulo="6. Consultas y reclamos">
            <p>
              Para consultar el estado de sus reservas o cancelarlas, puede
              hacerlo directamente en{" "}
              <Link
                href="/consulta"
                className="font-semibold text-[var(--umng-navy)] underline underline-offset-2"
              >
                la página de consulta
              </Link>{" "}
              con su código estudiantil y su correo.
            </p>
            <p>
              Para ejercer cualquiera de los derechos del numeral anterior,
              incluida la supresión de sus datos, escriba a{" "}
              <a
                href={`mailto:${RESPONSABLE.correo}`}
                className="font-semibold text-[var(--umng-navy)] underline underline-offset-2"
              >
                {RESPONSABLE.correo}
              </a>{" "}
              indicando su nombre, código estudiantil y la solicitud concreta. Las
              consultas se atienden en un máximo de diez (10) días hábiles y los
              reclamos en un máximo de quince (15) días hábiles, prorrogables en
              los términos de ley.
            </p>
          </Seccion>

          <Seccion titulo="7. Almacenamiento y transmisión internacional">
            <p>
              La información se almacena en la infraestructura de Supabase, cuyos
              servidores se encuentran en Estados Unidos de América. Al autorizar
              el tratamiento, el titular acepta esta transmisión internacional,
              realizada bajo las condiciones de seguridad y confidencialidad
              exigidas por la normativa colombiana.
            </p>
          </Seccion>

          <Seccion titulo="8. Vigencia">
            <p>
              Esta política rige desde {POLITICA_VIGENCIA}. Los datos se conservan
              mientras sean necesarios para la gestión académica y estadística de
              los laboratorios, y mientras exista deber legal de conservarlos.
            </p>
          </Seccion>

          <div className="mt-10 rounded-lg bg-[var(--umng-surface)] p-4 text-xs text-[var(--umng-muted)]">
            Documento en revisión por el área de protección de datos de la
            institución. Versión {POLITICA_VERSION}.
          </div>

          <div className="mt-6">
            <Link href="/reservar" className="btn-secondary inline-block">
              ← Volver a reservar
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}
