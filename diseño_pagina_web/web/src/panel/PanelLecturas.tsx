import { hace, useAhora, type Conexion, type Nodo } from '../bancal'
import { IconoSensores } from './iconos'
import { PanelDesplegable } from './PanelDesplegable'

type Props = {
  conexion: Conexion
  broker: boolean
  nodoId: string
  nodo: Nodo | null
}

/** Los {tipo} de `{nodoId}/sensor/{tipo}` que publica el firmware, en el orden en que se muestran. */
const SENSORES: { id: string; nombre: string; formato: (valor: number) => string }[] = [
  { id: 'temperatura_aire', nombre: 'Temperatura del aire', formato: (v) => `${v.toFixed(1)} °C` },
  { id: 'humedad_aire', nombre: 'Humedad del aire', formato: (v) => `${Math.round(v)} %` },
  { id: 'temperatura_suelo', nombre: 'Temperatura del suelo', formato: (v) => `${v.toFixed(1)} °C` },
  { id: 'humedad_suelo', nombre: 'Humedad del suelo', formato: (v) => `${Math.round(v)} %` },
  { id: 'luz', nombre: 'Luz', formato: (v) => (v === 1 ? 'Hay luz' : 'Oscuro') },
]

type Estado = { tono: 'ok' | 'alerta' | 'error' | 'apagado'; texto: string }

function estadoConexion({ conexion, broker, nodoId, nodo }: Props, ahora: number): Estado {
  if (conexion === 'conectando') return { tono: 'alerta', texto: 'Conectando con el servicio…' }
  if (conexion === 'caida') return { tono: 'error', texto: 'Sin conexión con el servicio. Reintentando…' }
  if (!broker) return { tono: 'error', texto: 'El servicio no está conectado al broker' }
  if (nodo?.presencia === 'online') return { tono: 'ok', texto: `${nodoId} en línea` }
  if (nodo?.presencia === 'offline') {
    return { tono: 'apagado', texto: `${nodoId} desconectado (${hace(nodo.instantePresencia, ahora)})` }
  }
  return { tono: 'apagado', texto: `${nodoId}: todavía no hay datos` }
}

/**
 * Botón flotante arriba a la izquierda que despliega lo último que llegó de cada sensor del bancal
 * y el estado de la conexión (servicio, broker y presencia del ESP32).
 */
export function PanelLecturas(props: Props) {
  const ahora = useAhora()
  const { tono, texto } = estadoConexion(props, ahora)
  const lecturas = props.nodo?.lecturas ?? {}
  const ultima = Math.max(0, ...Object.values(lecturas).map((l) => l.instante))

  return (
    <PanelDesplegable
      lado="izquierda"
      titulo="Sensores"
      icono={<IconoSensores />}
      insignia={<span className="punto-estado" data-estado={tono} role="img" aria-label={texto} />}
    >
      <p className="lecturas-estado" role="status">
        <span className="punto-estado" data-estado={tono} aria-hidden />
        <span>
          <strong>{texto}</strong>
          {ultima > 0 && (
            <>
              <br />
              Última lectura {hace(ultima, ahora)}
            </>
          )}
        </span>
      </p>

      <ul className="lecturas-lista">
        {SENSORES.map(({ id, nombre, formato }) => {
          const lectura = lecturas[id]
          // undefined: nunca llegó; valor null: el ESP32 publicó "nan" (el sensor no respondió)
          const textoValor = !lectura ? '—' : lectura.valor === null ? 'sin dato' : formato(lectura.valor)
          return (
            <li key={id} className="lectura">
              <span className="lectura-nombre">{nombre}</span>
              <span
                className="lectura-valor"
                data-sin-dato={!lectura || lectura.valor === null}
                title={lectura ? `Llegó ${hace(lectura.instante, ahora)}` : 'Todavía no llegó ninguna lectura'}
              >
                {textoValor}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="flotante-nota">El ESP32 manda una lectura cada 5 s.</p>
    </PanelDesplegable>
  )
}
