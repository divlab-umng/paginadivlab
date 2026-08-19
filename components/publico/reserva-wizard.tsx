// components/publico/reserva-wizard.tsx
// Wizard del estudiante (sin login). 3 pasos:
//   1) Identidad  → nombre, correo institucional, código de estudiante.
//   2) Materia → habilita SOLO los laboratorios correspondientes.
//   3) Horario   → calendario semanal (se conecta en la Fase 2).
"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { CalendarioSemanal, type Sesion } from "@/components/publico/calendario-semanal";
import {
  solicitarReservas,
  type ResultadoFranja,
  type Integrante,
} from "@/app/(publico)/reservar/actions";

export type Subject = { id: string; code: string; name: string };
export type Program = { id: string; code: string; name: string };
export type Lab = { code: string; name: string };
export type LabsBySubject = Record<string, Lab[]>;
export type SubjectsByProgram = Record<string, Subject[]>;

type Identity = { fullName: string; email: string; code: string };

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@unimilitar\.edu\.co$/i;
const CODE_RE = /^[0-9]{4,15}$/;

function tituloLimpio(name: string) {
  return name.replace(/^LABORATORIO\s+/i, "");
}

export function ReservaWizard({
  programs,
  subjectsByProgram,
  labsBySubject,
}: {
  programs: Program[];
  subjectsByProgram: SubjectsByProgram;
  labsBySubject: LabsBySubject;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Paso 1 — identidad
  const [identity, setIdentity] = useState<Identity>({
    fullName: "",
    email: "",
    code: "",
  });
  const [touched, setTouched] = useState({
    fullName: false,
    email: false,
    code: false,
  });
  // Autorización de tratamiento de datos (Ley 1581). Sin esto no se puede reservar.
  const [autoriza, setAutoriza] = useState(false);

  // Paso 2 — cascada carrera → materia → laboratorio
  const [programId, setProgramId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [labCode, setLabCode] = useState<string | null>(null);

  // Paso 3 — franjas elegidas, grupo de trabajo y envío
  const [seleccion, setSeleccion] = useState<Sesion[]>([]);
  const [integrantes, setIntegrantes] = useState<Integrante[]>([]);
  // Lo publica el calendario al cargar: null o 1 = el lab no admite grupos.
  const [maxGrupo, setMaxGrupo] = useState<number | null>(null);
  const [enviando, startEnvio] = useTransition();
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoFranja[] | null>(null);

  const admiteGrupos = (maxGrupo ?? 1) > 1;

  // useCallback: el calendario lo usa dentro de un efecto; sin esto se
  // recargarían las franjas en bucle.
  const recibirDatosLab = useCallback(
    (d: { maxGroupSize: number | null }) => setMaxGrupo(d.maxGroupSize),
    []
  );

  const errors = {
    fullName: identity.fullName.trim().length < 3 ? "Ingresa tu nombre completo." : "",
    email: !EMAIL_RE.test(identity.email.trim())
      ? "Usa tu correo @unimilitar.edu.co."
      : "",
    code: !CODE_RE.test(identity.code.trim())
      ? "El código debe ser numérico (4 a 15 dígitos)."
      : "",
  };
  const identityValid =
    !errors.fullName && !errors.email && !errors.code && autoriza;

  // Cada nivel de la cascada depende del anterior.
  const enabledSubjects = useMemo(
    () => (programId ? subjectsByProgram[programId] ?? [] : []),
    [programId, subjectsByProgram]
  );
  const enabledLabs = useMemo(
    () => (subjectId ? labsBySubject[subjectId] ?? [] : []),
    [subjectId, labsBySubject]
  );

  const selectedProgram = programs.find((p) => p.id === programId) ?? null;
  const selectedSubject = enabledSubjects.find((s) => s.id === subjectId) ?? null;
  const selectedLab = enabledLabs.find((l) => l.code === labCode) ?? null;

  // Al cambiar un nivel de la cascada se limpia todo lo que dependía de él.
  function selectProgram(id: string) {
    setProgramId(id || null);
    setSubjectId(null);
    setLabCode(null);
    setSeleccion([]);
    setMaxGrupo(null);
    setIntegrantes([]);
  }

  function selectSubject(id: string) {
    setSubjectId(id || null);
    setLabCode(null);   // al cambiar de materia, se limpia el lab elegido
    setSeleccion([]);   // …y las franjas, que pertenecían a otro laboratorio
    setMaxGrupo(null);
    setIntegrantes([]);
  }

  function selectLab(code: string) {
    setLabCode(code);
    setSeleccion([]);   // las franjas son de un lab concreto
    setIntegrantes([]); // …y la política de grupos también
    setMaxGrupo(null);
  }

  function toggleFranja(s: Sesion) {
    setSeleccion((prev) =>
      prev.some((x) => x.session_id === s.session_id)
        ? prev.filter((x) => x.session_id !== s.session_id)
        : [...prev, s]
    );
  }

  function enviar() {
    if (!subjectId || seleccion.length === 0) return;
    setErrorEnvio(null);
    startEnvio(async () => {
      const res = await solicitarReservas({
        sessionIds: seleccion.map((s) => s.session_id),
        subjectId,
        fullName: identity.fullName.trim(),
        email: identity.email.trim(),
        code: identity.code.trim(),
        materia: selectedSubject?.name,
        integrantes: admiteGrupos ? integrantes : [],
        autorizaDatos: autoriza,
        programId,
      });
      if (res.ok) setResultados(res.resultados);
      else setErrorEnvio(res.error);
    });
  }

  // Pantalla final: ya se envió la solicitud.
  if (resultados) {
    return (
      <Confirmacion
        resultados={resultados}
        seleccion={seleccion}
        identity={identity}
        integrantes={admiteGrupos ? integrantes : []}
        labName={selectedLab ? tituloLimpio(selectedLab.name) : ""}
        programName={selectedProgram?.name ?? ""}
        subjectName={selectedSubject?.name ?? ""}
      />
    );
  }

  return (
    <div className="card-elevated overflow-hidden">
      <Stepper step={step} />

      <div className="px-5 py-6 sm:px-8">
        {step === 1 && (
          <StepIdentity
            identity={identity}
            errors={errors}
            touched={touched}
            onChange={(patch) => setIdentity((prev) => ({ ...prev, ...patch }))}
            onBlur={(field) => setTouched((t) => ({ ...t, [field]: true }))}
            autoriza={autoriza}
            onAutoriza={setAutoriza}
          />
        )}

        {step === 2 && (
          <StepSubjectLab
            programs={programs}
            programId={programId}
            enabledSubjects={enabledSubjects}
            subjectId={subjectId}
            enabledLabs={enabledLabs}
            labCode={labCode}
            onSelectProgram={selectProgram}
            onSelectSubject={selectSubject}
            onSelectLab={selectLab}
          />
        )}

        {step === 3 && labCode && (
          <StepHorario
            labCode={labCode}
            identity={identity}
            programName={selectedProgram?.name ?? ""}
            subjectName={selectedSubject?.name ?? ""}
            labName={selectedLab ? tituloLimpio(selectedLab.name) : ""}
            seleccion={seleccion}
            onToggle={toggleFranja}
            onDatosLab={recibirDatosLab}
            admiteGrupos={admiteGrupos}
            maxGrupo={maxGrupo ?? 1}
            integrantes={integrantes}
            onIntegrantes={setIntegrantes}
            error={errorEnvio}
          />
        )}
      </div>

      {/* Navegación */}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--umng-border)] px-5 py-4 sm:px-8">
        <button
          type="button"
          onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
          disabled={step === 1}
          className="btn-secondary disabled:opacity-0"
        >
          Atrás
        </button>

        {step === 1 && (
          <button
            type="button"
            onClick={() => {
              setTouched({ fullName: true, email: true, code: true });
              if (identityValid) setStep(2);
            }}
            disabled={!identityValid}
            className="btn-primary"
          >
            Continuar
          </button>
        )}
        {step === 2 && (
          <button
            type="button"
            onClick={() => labCode && setStep(3)}
            disabled={!labCode}
            className="btn-primary"
          >
            Continuar
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            onClick={enviar}
            disabled={seleccion.length === 0 || enviando}
            className="btn-primary"
          >
            {enviando
              ? "Enviando…"
              : seleccion.length === 0
              ? "Elige una franja"
              : `Confirmar ${seleccion.length} ${
                  seleccion.length === 1 ? "franja" : "franjas"
                }${integrantes.length > 0 ? ` · ${integrantes.length + 1} personas` : ""}`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Stepper                                                                  */
/* ----------------------------------------------------------------------- */
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    { n: 1, label: "Tus datos" },
    { n: 2, label: "Materia y lab" },
    { n: 3, label: "Horario" },
  ] as const;

  return (
    <ol className="flex items-center gap-2 border-b border-[var(--umng-border)] bg-[var(--umng-navy-50)] px-5 py-4 sm:px-8">
      {items.map((it, i) => {
        const state = step === it.n ? "active" : step > it.n ? "done" : "todo";
        return (
          <li key={it.n} className="flex flex-1 items-center gap-2">
            <span
              className="step-dot shrink-0"
              data-state={state}
              aria-current={state === "active" ? "step" : undefined}
            >
              {state === "done" ? "✓" : it.n}
            </span>
            <span
              className={`hidden text-sm font-medium sm:inline ${
                state === "todo" ? "text-[var(--umng-muted)]" : "text-[var(--umng-navy)]"
              }`}
            >
              {it.label}
            </span>
            {i < items.length - 1 && (
              <span className="mx-1 hidden h-px flex-1 bg-[var(--umng-navy-100)] sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------------------------------------------------- */
/* Paso 1 — Identidad                                                       */
/* ----------------------------------------------------------------------- */
function StepIdentity({
  identity,
  errors,
  touched,
  onChange,
  onBlur,
  autoriza,
  onAutoriza,
}: {
  identity: Identity;
  errors: Record<keyof Identity, string>;
  touched: Record<keyof Identity, boolean>;
  onChange: (patch: Partial<Identity>) => void;
  onBlur: (field: keyof Identity) => void;
  autoriza: boolean;
  onAutoriza: (v: boolean) => void;
}) {
  return (
    <div>
      <h2 className="text-lg">Cuéntanos quién reserva</h2>
      <p className="mt-1 text-sm text-[var(--umng-muted)]">
        Con estos datos el laboratorista validará tu asistencia. No necesitas
        contraseña.
      </p>

      <div className="mt-5 space-y-4">
        <FieldLg
          label="Nombre completo"
          value={identity.fullName}
          onChange={(v) => onChange({ fullName: v })}
          onBlur={() => onBlur("fullName")}
          error={touched.fullName ? errors.fullName : ""}
          autoComplete="name"
          placeholder="Ej. Ana María Rodríguez"
        />
        <FieldLg
          label="Correo institucional"
          value={identity.email}
          onChange={(v) => onChange({ email: v })}
          onBlur={() => onBlur("email")}
          error={touched.email ? errors.email : ""}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="usuario@unimilitar.edu.co"
        />
        <FieldLg
          label="Código de estudiante"
          value={identity.code}
          onChange={(v) => onChange({ code: v.replace(/\D/g, "") })}
          onBlur={() => onBlur("code")}
          error={touched.code ? errors.code : ""}
          inputMode="numeric"
          mono
          placeholder="Ej. 1801234"
          hint="El mismo número del código de barras de tu carné."
        />
      </div>

      {/* Autorización de tratamiento de datos — Ley 1581 de 2012 */}
      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--umng-border)] bg-[var(--umng-surface)] p-4">
        <input
          type="checkbox"
          checked={autoriza}
          onChange={(e) => onAutoriza(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span className="text-sm text-[var(--umng-ink)]">
          Autorizo al administrador de la plataforma a tratar mis datos
          personales para gestionar mi práctica de laboratorio y el control de
          asistencia, conforme a la{" "}
          <a
            href="/politica-datos"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--umng-navy)] underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            política de tratamiento de datos
          </a>
          .
        </span>
      </label>
    </div>
  );
}

function FieldLg({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  mono,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error?: string;
  hint?: string;
  mono?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur">) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--umng-ink)]">
        {label}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? true : undefined}
        className={`field-lg ${mono ? "font-data" : ""}`}
      />
      {error ? (
        <span role="alert" className="mt-1 block text-xs font-medium text-[var(--umng-crimson)]">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-[var(--umng-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

/* ----------------------------------------------------------------------- */
/* Paso 2 — Materia → Laboratorio                                           */
/* ----------------------------------------------------------------------- */
/**
 * Cascada de tres niveles: Carrera → Materia → Laboratorio.
 * Cada desplegable se habilita solo cuando el anterior tiene valor, y muestra
 * únicamente lo que corresponde a esa selección. Se usan `select` nativos: en
 * móvil abren el selector del sistema, que es más cómodo que una lista de
 * tarjetas y ocupa mucho menos espacio.
 */
function StepSubjectLab({
  programs,
  programId,
  enabledSubjects,
  subjectId,
  enabledLabs,
  labCode,
  onSelectProgram,
  onSelectSubject,
  onSelectLab,
}: {
  programs: Program[];
  programId: string | null;
  enabledSubjects: Subject[];
  subjectId: string | null;
  enabledLabs: Lab[];
  labCode: string | null;
  onSelectProgram: (id: string) => void;
  onSelectSubject: (id: string) => void;
  onSelectLab: (code: string) => void;
}) {
  return (
    <div>
      <h2 className="text-lg">¿Para qué práctica es?</h2>
      <p className="mt-1 text-sm text-[var(--umng-muted)]">
        Elige tu carrera y te mostramos solo las materias y los laboratorios que
        te corresponden.
      </p>

      {programs.length === 0 ? (
        <p className="mt-5 rounded-lg bg-[var(--umng-surface)] p-4 text-sm text-[var(--umng-muted)]">
          Aún no hay carreras configuradas. Comunícate con la División de
          Laboratorios.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <Desplegable
            label="Carrera"
            value={programId ?? ""}
            onChange={onSelectProgram}
            placeholder="Selecciona tu carrera…"
            options={programs.map((p) => ({ value: p.id, label: p.name }))}
          />

          <Desplegable
            label="Materia"
            value={subjectId ?? ""}
            onChange={onSelectSubject}
            disabled={!programId}
            placeholder={
              !programId
                ? "Primero elige tu carrera"
                : enabledSubjects.length === 0
                ? "Tu carrera no tiene materias configuradas"
                : "Selecciona la materia…"
            }
            options={enabledSubjects.map((s) => ({ value: s.id, label: s.name }))}
          />

          <Desplegable
            label="Laboratorio"
            value={labCode ?? ""}
            onChange={onSelectLab}
            disabled={!subjectId}
            placeholder={
              !subjectId
                ? "Primero elige la materia"
                : enabledLabs.length === 0
                ? "Esta materia no tiene laboratorios asignados"
                : "Selecciona el laboratorio…"
            }
            options={enabledLabs.map((l) => ({
              value: l.code,
              label: tituloLimpio(l.name),
            }))}
            hint={
              subjectId && enabledLabs.length === 1
                ? "Es el único laboratorio habilitado para esta materia."
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

function Desplegable({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  hint?: string;
}) {
  const sinOpciones = !disabled && options.length === 0;

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--umng-ink)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || sinOpciones}
        className="field-lg appearance-none bg-white disabled:cursor-not-allowed disabled:bg-[var(--umng-surface)] disabled:text-[var(--umng-muted)]"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <span className="mt-1 block text-xs text-[var(--umng-muted)]">{hint}</span>
      )}
    </label>
  );
}

/* ----------------------------------------------------------------------- */
/* Paso 3 — Calendario semanal y selección de franjas                       */
/* ----------------------------------------------------------------------- */
function fechaLarga(iso: string) {
  const d = new Date(iso + "T00:00:00"); // mediodía local: evita corrimiento de día
  const s = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const hhmm = (t: string) => t.slice(0, 5);

function StepHorario({
  labCode,
  identity,
  programName,
  subjectName,
  labName,
  seleccion,
  onToggle,
  onDatosLab,
  admiteGrupos,
  maxGrupo,
  integrantes,
  onIntegrantes,
  error,
}: {
  labCode: string;
  identity: Identity;
  programName: string;
  subjectName: string;
  labName: string;
  seleccion: Sesion[];
  onToggle: (s: Sesion) => void;
  onDatosLab: (d: { maxGroupSize: number | null }) => void;
  admiteGrupos: boolean;
  maxGrupo: number;
  integrantes: Integrante[];
  onIntegrantes: (v: Integrante[]) => void;
  error: string | null;
}) {
  const ordenadas = [...seleccion].sort((a, b) =>
    (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time)
  );

  return (
    <div>
      <h2 className="text-lg">Elige tus franjas</h2>
      <p className="mt-1 text-sm text-[var(--umng-muted)]">
        Toca los bloques disponibles. Puedes elegir varios y confirmarlos de una
        sola vez. Se reserva con mínimo 24 horas de anticipación.
      </p>

      {/* Resumen de la solicitud */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="chip">{identity.fullName}</span>
        <span className="chip font-data">{identity.code}</span>
        {programName && <span className="chip">{programName}</span>}
        {subjectName && <span className="chip">{subjectName}</span>}
        {labName && <span className="chip">{labName}</span>}
      </div>

      <div className="mt-5">
        <CalendarioSemanal
          labCode={labCode}
          seleccion={seleccion}
          onToggle={onToggle}
          onDatosLab={onDatosLab}
        />
      </div>

      {/* Grupo de trabajo: solo si el laboratorio lo admite */}
      {admiteGrupos && (
        <GrupoDeTrabajo
          maxGrupo={maxGrupo}
          integrantes={integrantes}
          onIntegrantes={onIntegrantes}
          codigoLider={identity.code}
        />
      )}

      {/* Carrito de franjas elegidas */}
      {ordenadas.length > 0 && (
        <div className="mt-5 rounded-xl border border-[var(--umng-sky)] bg-[var(--umng-sky-50)] p-4">
          <h3 className="text-sm font-semibold text-[var(--umng-navy)]">
            {ordenadas.length} {ordenadas.length === 1 ? "franja elegida" : "franjas elegidas"}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {ordenadas.map((s) => (
              <li
                key={s.session_id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-[var(--umng-ink)]">
                  {fechaLarga(s.session_date)} ·{" "}
                  <span className="font-data">
                    {hhmm(s.start_time)}–{hhmm(s.end_time)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(s)}
                  className="shrink-0 text-xs font-semibold text-[var(--umng-crimson)] underline-offset-2 hover:underline"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-[var(--umng-crimson)]/30 bg-[var(--umng-crimson)]/5 px-3 py-2 text-sm text-[var(--umng-crimson)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Grupo de trabajo — solo en labs con puestos compartidos                  */
/* ----------------------------------------------------------------------- */
function GrupoDeTrabajo({
  maxGrupo,
  integrantes,
  onIntegrantes,
  codigoLider,
}: {
  maxGrupo: number;
  integrantes: Integrante[];
  onIntegrantes: (v: Integrante[]) => void;
  codigoLider: string;
}) {
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);

  // El líder ya cuenta como integrante: por eso -1.
  const cuposLibres = maxGrupo - 1 - integrantes.length;

  function agregar() {
    const n = nombre.trim();
    const c = correo.trim().toLowerCase();
    const k = codigo.trim();

    if (n.length < 3) return setError("Escribe el nombre completo del compañero.");
    if (!EMAIL_RE.test(c)) return setError("El correo debe ser @unimilitar.edu.co.");
    if (!CODE_RE.test(k)) return setError("El código debe ser numérico (4 a 15 dígitos).");
    if (k === codigoLider.trim()) return setError("Ese es tu propio código.");
    if (integrantes.some((m) => m.codigo === k))
      return setError("Ese compañero ya está en el grupo.");
    if (cuposLibres <= 0)
      return setError(`Este laboratorio admite grupos de máximo ${maxGrupo} personas.`);

    onIntegrantes([...integrantes, { nombre: n, correo: c, codigo: k }]);
    setNombre("");
    setCorreo("");
    setCodigo("");
    setError(null);
  }

  return (
    <div className="mt-5 rounded-xl border border-[var(--umng-navy-100)] bg-[var(--umng-navy-50)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--umng-navy)]">
          Grupo de trabajo <span className="font-normal">(opcional)</span>
        </h3>
        <span className="font-data text-xs text-[var(--umng-muted)]">
          {integrantes.length + 1} de {maxGrupo} personas
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--umng-muted)]">
        En este laboratorio se trabaja por puestos: todo el grupo ocupa un solo
        puesto, pero cada integrante ocupa un cupo del aforo. Agrega a tus
        compañeros y todos quedarán en la misma solicitud.
      </p>

      {integrantes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {integrantes.map((m) => (
            <li
              key={m.codigo}
              className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate text-[var(--umng-ink)]">{m.nombre}</span>
                <span className="block truncate font-data text-xs text-[var(--umng-muted)]">
                  {m.codigo} · {m.correo}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onIntegrantes(integrantes.filter((x) => x.codigo !== m.codigo))}
                className="shrink-0 text-xs font-semibold text-[var(--umng-crimson)] hover:underline"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      {cuposLibres > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1.4fr_1.6fr_1fr_auto]">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del compañero"
            className="field-lg bg-white text-sm"
          />
          <input
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            type="email"
            inputMode="email"
            placeholder="correo@unimilitar.edu.co"
            className="field-lg bg-white text-sm"
          />
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="Código"
            className="field-lg bg-white font-data text-sm"
          />
          <button type="button" onClick={agregar} className="btn-secondary shrink-0 text-sm">
            Agregar
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-[var(--umng-navy)]">
          Grupo completo ({maxGrupo} personas).
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-[var(--umng-crimson)]">
          {error}
        </p>
      )}

      {/* Datos de terceros: quien arma el grupo declara tener su autorización.
          Es el punto más sensible del flujo bajo la Ley 1581. */}
      {integrantes.length > 0 && (
        <p className="mt-3 rounded-lg border border-[var(--umng-navy-100)] bg-white p-3 text-xs text-[var(--umng-ink)]">
          Al agregar a tus compañeros declaras que{" "}
          <strong>cuentas con su autorización</strong> para registrar su nombre y
          código, conforme a la{" "}
          <a
            href="/politica-datos"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--umng-navy)] underline underline-offset-2"
          >
            política de tratamiento de datos
          </a>
          . Cada uno recibirá un correo avisándole que fue incluido y podrá
          cancelar su cupo por su cuenta.
        </p>
      )}

      {integrantes.length === 0 && (
        <p className="mt-3 text-xs text-[var(--umng-muted)]">
          Cada compañero recibirá un correo avisándole que fue incluido, y podrá
          cancelar su cupo si no puede asistir.
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Pantalla final — confirmación (maneja fallos parciales)                  */
/* ----------------------------------------------------------------------- */
function Confirmacion({
  resultados,
  seleccion,
  identity,
  integrantes,
  labName,
  programName,
  subjectName,
}: {
  resultados: ResultadoFranja[];
  seleccion: Sesion[];
  identity: Identity;
  integrantes: Integrante[];
  labName: string;
  programName: string;
  subjectName: string;
}) {
  const porId = new Map(seleccion.map((s) => [s.session_id, s]));
  const creadas = resultados.filter((r) => r.ok);
  const fallidas = resultados.filter((r) => !r.ok);
  const enGrupo = integrantes.length > 0;
  const personas = integrantes.length + 1;
  const totalReservas = creadas.reduce((acc, r) => acc + (r.creadas ?? 1), 0);

  const detalle = (id: string) => {
    const s = porId.get(id);
    if (!s) return "Franja";
    return `${fechaLarga(s.session_date)} · ${hhmm(s.start_time)}–${hhmm(s.end_time)}`;
  };

  return (
    <div className="card-elevated overflow-hidden">
      <div
        className="px-6 py-6 text-white"
        style={{
          background:
            creadas.length > 0 ? "var(--umng-green)" : "var(--umng-crimson)",
        }}
      >
        <h2 className="text-xl font-semibold text-white">
          {creadas.length > 0
            ? "¡Solicitud enviada!"
            : "No se pudo registrar tu solicitud"}
        </h2>
        <p className="mt-1 text-sm text-white/85">
          {creadas.length > 0
            ? enGrupo
              ? `${totalReservas} reservas en estado Pendiente (${personas} personas × ${creadas.length} ${
                  creadas.length === 1 ? "franja" : "franjas"
                }). El laboratorista revisará a cada estudiante.`
              : `${creadas.length} ${
                  creadas.length === 1
                    ? "reserva quedó en estado Pendiente. El laboratorista la revisará."
                    : "reservas quedaron en estado Pendiente. El laboratorista las revisará."
                }`
            : "Revisa el detalle e intenta de nuevo."}
        </p>
      </div>

      <div className="space-y-5 px-6 py-6">
        {/* Datos del estudiante */}
        <div className="flex flex-wrap gap-2">
          <span className="chip">{identity.fullName}</span>
          <span className="chip font-data">{identity.code}</span>
          {programName && <span className="chip">{programName}</span>}
          {subjectName && <span className="chip">{subjectName}</span>}
          {labName && <span className="chip">{labName}</span>}
        </div>

        {/* Integrantes del grupo */}
        {enGrupo && creadas.length > 0 && (
          <div className="rounded-xl border border-[var(--umng-sky)] bg-[var(--umng-sky-50)] p-4">
            <h3 className="text-sm font-semibold text-[var(--umng-navy)]">
              Grupo de trabajo · {personas} personas
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              <li className="flex flex-wrap items-baseline gap-2">
                <span className="text-[var(--umng-ink)]">{identity.fullName}</span>
                <span className="font-data text-xs text-[var(--umng-muted)]">
                  {identity.code}
                </span>
                <span className="badge badge-aprobada">Creó el grupo</span>
              </li>
              {integrantes.map((m) => (
                <li key={m.codigo} className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[var(--umng-ink)]">{m.nombre}</span>
                  <span className="font-data text-xs text-[var(--umng-muted)]">
                    {m.codigo}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--umng-muted)]">
              Todo el grupo ocupa un solo puesto de trabajo. Cada integrante
              recibió un correo y puede cancelar su cupo por separado.
            </p>
          </div>
        )}

        {creadas.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[var(--umng-navy)]">
              Reservas registradas
            </h3>
            <ul className="mt-2 space-y-2">
              {creadas.map((r) => (
                <li
                  key={r.session_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--umng-border)] px-3 py-2 text-sm"
                >
                  <span>{detalle(r.session_id)}</span>
                  <span className="badge badge-pendiente shrink-0">Pendiente</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {fallidas.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[var(--umng-crimson)]">
              No se pudieron reservar
            </h3>
            <ul className="mt-2 space-y-2">
              {fallidas.map((r) => (
                <li
                  key={r.session_id}
                  className="rounded-lg border border-[var(--umng-crimson)]/30 bg-[var(--umng-crimson)]/5 px-3 py-2 text-sm"
                >
                  <p className="text-[var(--umng-ink)]">{detalle(r.session_id)}</p>
                  <p className="mt-0.5 text-xs text-[var(--umng-crimson)]">
                    {r.error}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* El estudiante NO recibe correo al solicitar ni si lo rechazan: solo
            si le aprueban. Por eso aquí se le dice explícitamente que consulte
            su estado, o quedaría esperando un mensaje que puede no llegar. */}
        <div className="rounded-lg border border-[var(--umng-gold)] bg-[color-mix(in_srgb,var(--umng-gold)_8%,#fff)] p-4 text-sm text-[var(--umng-ink)]">
          <p className="font-semibold">Cómo sabrás si te aprobaron</p>
          <p className="mt-1 text-[var(--umng-muted)]">
            Recibirás un correo <strong>solo si el laboratorista aprueba</strong>{" "}
            tu práctica, con la fecha, el lugar y qué debes llevar. Si no te llega,
            consulta el estado con tu código{" "}
            <span className="font-data">{identity.code}</span> y tu correo.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <a href="/consulta" className="btn-primary inline-block text-center">
            Ver mis reservas
          </a>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-secondary"
          >
            Hacer otra solicitud
          </button>
        </div>
      </div>
    </div>
  );
}
