import { type ReactNode, useEffect, useId, useState } from 'react'
import { IconoCerrar } from './iconos'
import './panel.css'

type Props = {
  /**
   * Dónde va el botón: en una esquina superior (el panel se despliega debajo) o abajo al centro
   * (el panel se despliega arriba del botón).
   */
  lado: 'izquierda' | 'derecha' | 'abajo'
  /** Título del panel; también es el texto del botón si no se pasa `etiqueta`. */
  titulo: string
  /** Texto del botón, si tiene que ser distinto del título (por ejemplo, el bancal elegido). */
  etiqueta?: string
  icono: ReactNode
  /** Algo chico al lado del título del botón (contador, punto de estado...). */
  insignia?: ReactNode
  children: ReactNode
}

/**
 * Botón flotante que despliega un panel debajo. Se cierra con el botón, con la cruz o con Escape.
 * No se cierra al tocar la escena, así se puede mirar la animación con el panel abierto.
 */
export function PanelDesplegable({ lado, titulo, etiqueta, icono, insignia, children }: Props) {
  const [abierto, setAbierto] = useState(false)
  const idPanel = useId()

  useEffect(() => {
    if (!abierto) return
    const alPresionar = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [abierto])

  return (
    <div className="flotante" data-lado={lado}>
      <button
        type="button"
        className="flotante-boton"
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={() => setAbierto((a) => !a)}
      >
        {icono}
        <span>{etiqueta ?? titulo}</span>
        {insignia}
      </button>

      <section id={idPanel} className="flotante-panel" data-abierto={abierto} aria-label={titulo} inert={!abierto}>
        <header className="flotante-cabecera">
          <h2>{titulo}</h2>
          <button type="button" className="flotante-cerrar" aria-label="Cerrar" onClick={() => setAbierto(false)}>
            <IconoCerrar />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
