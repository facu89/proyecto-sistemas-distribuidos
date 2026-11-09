import { nombreBancal, type ResumenNodo } from '../bancal'
import { IconoBancal, IconoVivero } from './iconos'
import { PanelDesplegable } from './PanelDesplegable'

type Props = {
  lista: ResumenNodo[]
  nodoId: string
  onElegir: (nodoId: string) => void
}

type Tono = 'ok' | 'error' | 'apagado'

function estadoNodo({ presencia, alerta }: ResumenNodo): { tono: Tono; texto: string } {
  if (alerta) return { tono: 'error', texto: 'Caído' }
  if (presencia === 'online') return { tono: 'ok', texto: 'En línea' }
  if (presencia === 'offline') return { tono: 'error', texto: 'Desconectado' }
  return { tono: 'apagado', texto: 'Sin datos' }
}

/**
 * Botón "vivero" abajo al centro: muestra el bancal elegido y despliega arriba una card horizontal
 * con todos los bancales. El color de cada uno dice si está en línea o caído, así un problema en otro
 * bancal se ve sin tener que entrar a ese bancal.
 */
export function SelectorBancal({ lista, nodoId, onElegir }: Props) {
  if (lista.length === 0) return null

  const caidos = lista.filter((n) => estadoNodo(n).tono === 'error').length
  const resumen = caidos > 0 ? `${caidos} con problemas` : 'Todos en línea'

  return (
    <PanelDesplegable
      lado="abajo"
      titulo="Vivero"
      etiqueta={nombreBancal(nodoId)}
      icono={<IconoVivero />}
      insignia={
        <span
          className="punto-estado"
          data-estado={caidos > 0 ? 'error' : 'ok'}
          role="img"
          aria-label={`${lista.length} bancales, ${resumen.toLowerCase()}`}
        />
      }
    >
      <ul className="vivero-lista">
        {lista.map((nodo) => {
          const { tono, texto } = estadoNodo(nodo)
          return (
            <li key={nodo.id}>
              <button
                type="button"
                className="vivero-bancal"
                data-estado={tono}
                aria-current={nodo.id === nodoId ? 'true' : undefined}
                aria-label={`${nombreBancal(nodo.id)} (${nodo.id}): ${texto}`}
                title={nodo.id}
                onClick={() => onElegir(nodo.id)}
              >
                <span className="vivero-bancal-icono">
                  <IconoBancal />
                </span>
                <span className="vivero-bancal-nombre">{nombreBancal(nodo.id)}</span>
                <span className="vivero-bancal-estado">
                  <span className="punto-estado" data-estado={tono} aria-hidden />
                  {texto}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="flotante-nota">
        {lista.length} {lista.length === 1 ? 'bancal' : 'bancales'} · {resumen}
      </p>
    </PanelDesplegable>
  )
}
