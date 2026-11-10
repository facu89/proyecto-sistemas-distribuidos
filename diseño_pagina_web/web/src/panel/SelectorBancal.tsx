import { nombreBancal, type ResumenNodo } from '../bancal'
import { IconoBancal, IconoVivero } from './iconos'
import { PanelDesplegable } from './PanelDesplegable'
import { estadoNodo, resumenVivero } from './vivero'

type Props = {
  lista: ResumenNodo[]
  /** `null` si todavía no se conectó ningún bancal. */
  nodoId: string | null
  onElegir: (nodoId: string) => void
}

/**
 * Botón "vivero" abajo al centro: muestra el bancal elegido y despliega arriba una card horizontal
 * con todos los bancales. El color de cada uno dice si está en línea o caído, así un problema en otro
 * bancal se ve sin tener que entrar a ese bancal.
 */
export function SelectorBancal({ lista, nodoId, onElegir }: Props) {
  const resumen = resumenVivero(lista)
  const cantidad = `${lista.length} ${lista.length === 1 ? 'bancal' : 'bancales'}`

  return (
    <PanelDesplegable
      lado="abajo"
      titulo="Vivero"
      etiqueta={nodoId === null ? 'Sin bancales' : nombreBancal(nodoId)}
      icono={<IconoVivero />}
      insignia={
        <span
          className="punto-estado"
          data-estado={resumen.tono}
          role="img"
          aria-label={lista.length === 0 ? resumen.texto : `${cantidad}: ${resumen.texto}`}
        />
      }
    >
      {lista.length === 0 ? (
        <p className="flotante-nota vivero-vacio">
          Todavía no se conectó ningún bancal. Aparecen acá apenas su ESP32 se conecta al broker.
        </p>
      ) : (
        <>
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
            {cantidad} · {resumen.texto}
          </p>
        </>
      )}
    </PanelDesplegable>
  )
}
