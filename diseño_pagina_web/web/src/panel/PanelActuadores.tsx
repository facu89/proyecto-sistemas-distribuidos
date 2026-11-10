import { type ReactNode, useState } from 'react'
import { cambiarModo, ordenarActuador, type Modo } from '../api'
import { estaPendiente, type Instantanea, type Nodo } from '../bancal'
import type { Actuador, EstadoActuadores } from '../estado'
import { IconoControles, IconoLuz, IconoRiego, IconoVentilador } from './iconos'
import { PanelDesplegable } from './PanelDesplegable'
import './panel.css'

type Props = {
  estado: EstadoActuadores
  /** `null` si todavía no se conectó ningún bancal (los controles quedan deshabilitados). */
  nodoId: string | null
  nodo: Nodo | null
  umbrales: Instantanea['umbrales'] | null
  /** Si hay conexión con el servicio y el servicio con el broker: sin eso no se puede pedir nada. */
  disponible: boolean
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

const MODOS: { id: Modo; nombre: string }[] = [
  { id: 'automatico', nombre: 'Automático' },
  { id: 'manual', nombre: 'Manual' },
]

/**
 * Botón flotante arriba a la derecha que despliega los actuadores del bancal.
 *
 * - **Automático:** el servicio los prende y apaga según los sensores (software/servicio/src/reglas.ts);
 *   el panel solo muestra.
 * - **Manual:** las reglas no actúan y cada interruptor le pide la orden al servicio, que la publica en
 *   `/cmd`. El interruptor muestra lo pedido; el texto, lo que informa el ESP32 ("pendiente" si difieren).
 */
export function PanelActuadores({ estado, nodoId, nodo, umbrales, disponible }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Al cambiar de bancal en el selector, el error del pedido anterior ya no corresponde.
  const [nodoDelError, setNodoDelError] = useState(nodoId)
  if (nodoDelError !== nodoId) {
    setNodoDelError(nodoId)
    setError(null)
  }
  const modo = nodo?.modo ?? 'automatico'
  const manual = modo === 'manual'
  const habilitado = disponible && nodo !== null && !enviando
  const encendidos = ACTUADORES.filter((a) => estado[a.id]).length

  const pedir = async (pedido: (nodoId: string) => Promise<void>) => {
    if (nodoId === null) return
    setEnviando(true)
    setError(null)
    try {
      await pedido(nodoId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <PanelDesplegable
      lado="derecha"
      titulo="Actuadores"
      icono={<IconoControles />}
      insignia={
        <>
          {manual && <span className="flotante-etiqueta">Manual</span>}
          {encendidos > 0 && (
            <span className="flotante-contador" aria-label={`${encendidos} encendidos`}>
              {encendidos}
            </span>
          )}
        </>
      }
    >
      <div className="modo" role="group" aria-label="Modo de control">
        {MODOS.map(({ id, nombre }) => (
          <button
            key={id}
            type="button"
            className="modo-opcion"
            aria-pressed={modo === id}
            disabled={!habilitado}
            onClick={() => modo !== id && pedir((n) => cambiarModo(n, id))}
          >
            {nombre}
          </button>
        ))}
      </div>

      <ul className="actuadores-lista" data-modo={modo}>
        {ACTUADORES.map(({ id, nombre, icono, textos, regla }) => {
          const encendido = estado[id]
          const actuador = nodo?.actuadores[id]
          const pendiente = estaPendiente(actuador)
          // En manual el interruptor muestra lo pedido (lo último ordenado); el texto, el estado real.
          const pedido = actuador?.ordenado ?? encendido
          const textoRegla = regla(umbrales)
          const idNombre = `actuador-${id}`
          return (
            <li key={id} className="actuador" data-actuador={id} data-encendido={encendido}>
              <span className="actuador-icono">{icono}</span>
              <span className="actuador-texto">
                <span id={idNombre} className="actuador-nombre">
                  {nombre}
                </span>
                <span className="actuador-estado">
                  {textos[Number(encendido)]}
                  {pendiente && ' · pendiente'}
                </span>
                {textoRegla && (
                  <span className="actuador-regla">{manual ? `En automático: ${textoRegla[0].toLowerCase()}${textoRegla.slice(1)}` : textoRegla}</span>
                )}
              </span>
              {manual ? (
                <button
                  type="button"
                  role="switch"
                  className="interruptor"
                  data-encendido={pedido}
                  aria-checked={pedido}
                  aria-labelledby={idNombre}
                  disabled={!habilitado}
                  onClick={() => pedir((n) => ordenarActuador(n, id, !pedido))}
                >
                  <span className="interruptor-perilla" />
                </button>
              ) : (
                // En automático es solo un indicador: el estado ya se lee en el texto de al lado
                <span className="interruptor" data-encendido={encendido} aria-hidden>
                  <span className="interruptor-perilla" />
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {error && (
        <p className="flotante-error" role="alert">
          {error}
        </p>
      )}
      <p className="flotante-nota">
        {!disponible
          ? 'Sin conexión con el servicio: no se puede cambiar nada por ahora.'
          : manual
            ? 'Manual: los interruptores mandan la orden al bancal. Las reglas no actúan hasta volver a automático.'
            : 'Automático: el servicio los prende y apaga según los sensores del bancal.'}
      </p>
    </PanelDesplegable>
  )
}
