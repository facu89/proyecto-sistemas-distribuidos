import { type ReactNode, useEffect, useId, useState } from 'react'
import type { Actuador, EstadoActuadores } from '../estado'
import { IconoCerrar, IconoControles, IconoLuz, IconoRiego, IconoVentilador } from './iconos'
import './panel.css'

type Props = {
  estado: EstadoActuadores
  onCambiar: (actuador: Actuador, encendido: boolean) => void
}

const ACTUADORES: { id: Actuador; nombre: string; icono: ReactNode; textos: [string, string] }[] = [
  { id: 'luz', nombre: 'Luz', icono: <IconoLuz />, textos: ['Apagada', 'Encendida'] },
  { id: 'ventilador', nombre: 'Ventilador', icono: <IconoVentilador />, textos: ['Apagado', 'Encendido'] },
  { id: 'riego', nombre: 'Riego', icono: <IconoRiego />, textos: ['Apagado', 'Regando'] },
]

/**
 * Botón flotante arriba a la derecha que despliega el panel con un interruptor por actuador.
 * Se cierra con el botón o con Escape. No se cierra al tocar la escena, así se puede
 * mirar la animación con el panel abierto.
 */
export function PanelActuadores({ estado, onCambiar }: Props) {
  const [abierto, setAbierto] = useState(false)
  const idPanel = useId()
  const encendidos = ACTUADORES.filter((a) => estado[a.id]).length

  useEffect(() => {
    if (!abierto) return
    const alPresionar = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    window.addEventListener('keydown', alPresionar)
    return () => window.removeEventListener('keydown', alPresionar)
  }, [abierto])

  return (
    <div className="actuadores">
      <button
        type="button"
        className="actuadores-boton"
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={() => setAbierto((a) => !a)}
      >
        <IconoControles />
        <span>Actuadores</span>
        {encendidos > 0 && (
          <span className="actuadores-contador" aria-label={`${encendidos} encendidos`}>
            {encendidos}
          </span>
        )}
      </button>

      <section
        id={idPanel}
        className="actuadores-panel"
        data-abierto={abierto}
        aria-label="Actuadores"
        inert={!abierto}
      >
        <header className="actuadores-cabecera">
          <h2>Actuadores</h2>
          <button type="button" className="actuadores-cerrar" aria-label="Cerrar" onClick={() => setAbierto(false)}>
            <IconoCerrar />
          </button>
        </header>

        <ul className="actuadores-lista">
          {ACTUADORES.map(({ id, nombre, icono, textos }) => {
            const encendido = estado[id]
            const idEtiqueta = `${idPanel}-${id}`
            return (
              <li key={id} className="actuador" data-actuador={id} data-encendido={encendido}>
                <span className="actuador-icono">{icono}</span>
                <span className="actuador-texto">
                  <span id={idEtiqueta} className="actuador-nombre">
                    {nombre}
                  </span>
                  <span className="actuador-estado">{textos[Number(encendido)]}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  className="interruptor"
                  aria-checked={encendido}
                  aria-labelledby={idEtiqueta}
                  onClick={() => onCambiar(id, !encendido)}
                >
                  <span className="interruptor-perilla" />
                </button>
              </li>
            )
          })}
        </ul>

        <p className="actuadores-nota">Boceto: los cambios son solo visuales, todavía no se envían al bancal.</p>
      </section>
    </div>
  )
}
