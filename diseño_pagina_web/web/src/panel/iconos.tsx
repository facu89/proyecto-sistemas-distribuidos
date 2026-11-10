/** Íconos de línea (24×24, heredan el color del texto). */

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export function IconoLuz() {
  return (
    <svg {...base}>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
    </svg>
  )
}

export function IconoVentilador() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 10.4c-.4-2.4.4-4.6 2.6-4.9 1.7-.2 2.4 1.9 1 3.2-1 .9-2.3 1.4-3.6 1.7Z" />
      <path d="M13.4 12.8c2.2.9 3.7 2.7 2.8 4.7-.7 1.5-2.9 1.1-3.3-.7-.3-1.3-.1-2.7.5-4Z" />
      <path d="M10.6 12.8c-1.9 1.5-4.2 1.9-5.5.1-1-1.4.4-3.1 2.2-2.6 1.3.4 2.4 1.3 3.3 2.5Z" />
    </svg>
  )
}

export function IconoRiego() {
  return (
    <svg {...base}>
      <path d="M8 9h8l-.8 9.2a1 1 0 0 1-1 .8H9.8a1 1 0 0 1-1-.8L8 9Z" />
      <path d="M16 11c1.8 0 3 1 3 2.5S17.8 16 16 16" />
      <path d="M8.4 12 4 8.5" />
      <path d="M3 7.5l2-1M2.8 10l1.5-.2M5 5.2l.6-1.5" />
    </svg>
  )
}

export function IconoControles() {
  return (
    <svg {...base}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  )
}

export function IconoCerrar() {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

/** Invernadero (vivero): techo a dos aguas, paneles de vidrio y un brote adentro. */
export function IconoVivero() {
  return (
    <svg {...base}>
      <path d="M2.5 20.5h19" />
      <path d="M4 20.5V10l8-6 8 6v10.5" />
      <path d="M8 20.5V7M16 20.5V7" />
      <path d="M12 20.5v-4.5" />
      <path d="M12 17.2c-1.8 0-2.8-1-2.8-2.7 1.8 0 2.8 1 2.8 2.7Z" />
      <path d="M12 16c0-1.7 1-2.7 2.8-2.7 0 1.7-1 2.7-2.8 2.7Z" />
    </svg>
  )
}

/** Bancal: cajón de cultivo elevado con tres plantines. */
export function IconoBancal() {
  return (
    <svg {...base}>
      <path d="M3 14h18l-1.6 6.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L3 14Z" />
      <path d="M3.6 16.5h16.8" />
      <path d="M7 14v-3M12 14V8.5M17 14v-3" />
      <path d="M7 12c-1.4 0-2.2-.8-2.2-2.2 1.4 0 2.2.8 2.2 2.2Z" />
      <path d="M12 10c0-1.6.9-2.6 2.6-2.6 0 1.6-.9 2.6-2.6 2.6Z" />
      <path d="M12 11c-1.6 0-2.6-.9-2.6-2.6 1.6 0 2.6.9 2.6 2.6Z" />
      <path d="M17 12c0-1.4.8-2.2 2.2-2.2 0 1.4-.8 2.2-2.2 2.2Z" />
    </svg>
  )
}

export function IconoSensores() {
  return (
    <svg {...base}>
      <path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z" />
      <path d="M12 9v6" />
      <path d="M18 6h2M18 10h2" />
    </svg>
  )
}

/** Chevron; `hacia` elige para dónde apunta (abre/cierra el historial, pasa de página en las tablas). */
export function IconoFlecha({ hacia }: { hacia: 'arriba' | 'abajo' | 'izquierda' | 'derecha' }) {
  const d = { arriba: 'm6 15 6-6 6 6', abajo: 'm6 9 6 6 6-6', izquierda: 'm15 6-6 6 6 6', derecha: 'm9 6 6 6-6 6' }[hacia]
  return (
    <svg {...base}>
      <path d={d} />
    </svg>
  )
}
