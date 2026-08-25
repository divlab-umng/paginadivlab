// components/panel/barra-sesion.tsx
// Navegación común de las pantallas con sesión.
//
// UNA SOLA IMPLEMENTACIÓN PARA LOS DOS PANELES
//   El panel del laboratorista tiene cabecera azul (texto blanco) y el
//   dashboard del jefe fondo blanco (texto azul). Es la misma barra con dos
//   pieles, no dos componentes: si mañana se agrega una opción, aparece en
//   ambos sin que nadie tenga que acordarse del segundo.
//
// POR QUÉ UN FORM Y NO UN onClick
//   Cerrar sesión escribe (invalida la cookie), y las escrituras van por Server
//   Action. Al ir dentro de un <form>, funciona incluso si el JavaScript no
//   cargó — que en un celular con mala señal dentro de un laboratorio no es un
//   caso hipotético. Por eso este archivo NO lleva 'use client'.
import { signOut } from '@/app/(auth)/actions'

export function BarraSesion({
  piel = 'clara',
  children,
}: {
  /** 'oscura' = sobre la cabecera azul; 'clara' = sobre fondo blanco. */
  piel?: 'clara' | 'oscura'
  /** Botones propios de cada panel, que se muestran antes de los comunes. */
  children?: React.ReactNode
}) {
  const oscura = piel === 'oscura'

  const salir = oscura
    ? 'rounded-md border border-white/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/15'
    : 'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-[var(--umng-ink)]/80 transition hover:border-[var(--umng-crimson)] hover:text-[var(--umng-crimson)]'

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {children}

      <form action={signOut}>
        <button type="submit" className={salir}>
          Cerrar sesión
        </button>
      </form>
    </nav>
  )
}
