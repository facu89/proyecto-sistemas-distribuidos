import type { ReactNode } from 'react'
import { estaPendiente, type Instantanea, type Nodo } from '../bancal'
import type { Actuador, EstadoActuadores } from '../estado'
import { IconoControles, IconoLuz, IconoRiego, IconoVentilador } from './iconos'
import { PanelDesplegable } from './PanelDesplegable'
import './panel.css'

type Props = {
  estado: EstadoActuadores
  nodo: Nodo | null
  umbrales: Instantanea['umbrales'] | null
}

type Umbrales = Instantanea['umbrales']

const ACTUADORES: {
  id: Actuador
  nombre: string
  icono: ReactNode
  textos: [string, string]
  regla: (u: Umbrales | null) => string
}[] = [
  { id: 'luz', nombre: 'Luz', icono: <IconoLuz />, textos: ['Apagada', 'Encendida'], regla: () => 'Se prende a oscuras' },
  {
    id: 'cooler',
    nombre: 'Cooler',
    icono: <IconoVentilador />,
    textos: ['Apagado', 'Encendido'],
    regla: (u) => (u ? `Prende desde ${u.ventiladorEncenderDesde} °C, apaga bajo ${u.ventiladorApagarDebajoDe} °C` : ''),
  },
  {
    id: 'riego',
    nombre: 'Riego',
    icono: <IconoRiego />,
    textos: ['Apagado', 'Regando'],
    regla: (u) => (u ? `Riega bajo ${u.riegoEncenderDebajoDe} %, para desde ${u.riegoApagarDesde} %` : ''),
  },
]

/**
 * Botón flotante arriba a la derecha que despliega el estado de cada actuador.
 * Solo muestra: las órdenes las da el servicio según los sensores (software/servicio/src/reglas.ts).
 */
export function PanelActuadores({ estado, nodo, umbrales }: Props) {
  const encendidos = ACTUADORES.filter((a) => estado[a.id]).length

  return (
    <PanelDesplegable
      lado="derecha"
      titulo="Actuadores"
      icono={<IconoControles />}
      insignia={
        encendidos > 0 && (
          <span className="flotante-contador" aria-label={`${encendidos} encendidos`}>
            {encendidos}
          </span>
        )
      }
    >
      <ul className="actuadores-lista">
        {ACTUADORES.map(({ id, nombre, icono, textos, regla }) => {
          const encendido = estado[id]
          const pendiente = estaPendiente(nodo?.actuadores[id])
          const textoRegla = regla(umbrales)
          return (
            <li key={id} className="actuador" data-actuador={id} data-encendido={encendido}>
              <span className="actuador-icono">{icono}</span>
              <span className="actuador-texto">
                <span className="actuador-nombre">{nombre}</span>
                <span className="actuador-estado">
                  {textos[Number(encendido)]}
                  {pendiente && ' · pendiente'}
                </span>
                {textoRegla && <span className="actuador-regla">{textoRegla}</span>}
              </span>
              {/* Indicador, no interruptor: el estado ya se lee en el texto de al lado */}
              <span className="interruptor" data-encendido={encendido} aria-hidden>
                <span className="interruptor-perilla" />
              </span>
            </li>
          )
        })}
      </ul>

      <p className="flotante-nota">Automático: el servicio los prende y apaga según los sensores del bancal.</p>
    </PanelDesplegable>
  )
}
