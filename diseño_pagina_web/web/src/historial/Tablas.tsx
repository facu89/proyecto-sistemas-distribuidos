import { type CSSProperties, useEffect, useState } from 'react'
import { useAhora } from '../bancal'
import { IconoFlecha } from '../panel/iconos'
import { dia, fechaHora, hora, HORA, pedirHistorial, SENSORES, type Historial, type TipoSensor } from './datos'

/**
 * Cuánto muestra cada página de las tablas. Se guarda una lectura cada 10 minutos, así que 6 horas son
 * unas 36 filas por sensor: entra en pantalla sin que la tabla se vuelva interminable.
 */
export const VENTANA_MS = 6 * HORA
/** Lo más viejo que guarda el historial (la regla borra lo de más de 14 días). */
const LIMITE_MS = 14 * 24 * HORA

type Props = {
  nodoId: string
  /** `null`: los cinco sensores. */
  seleccion: TipoSensor | null
  /** Cambia cada vez que el dashboard refresca: si se está viendo lo último, se vuelve a pedir. */
  refresco: number
}

/**
 * Una tabla por sensor (hora y valor, lo más nuevo arriba) de una ventana de 6 horas. Las flechas
 * del título van 6 horas para atrás o para adelante, hasta los 14 días que guarda el historial.
 */
export function Tablas({ nodoId, seleccion, refresco }: Props) {
  // `null` = la ventana termina ahora y se actualiza sola; un número = una ventana fija del pasado
  const [fin, setFin] = useState<number | null>(null)
  const [datos, setDatos] = useState<Historial | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Qué pedido es el que está a la vista: si no es el actual, se está cargando otro
  const [cargado, setCargado] = useState<string | null>(null)
  const ahora = useAhora(60_000)

  // `refresco` solo importa cuando se ve lo último: una ventana del pasado no cambia
  const refrescoVivo = fin === null ? refresco : 0

  const pedido = `${nodoId}|${seleccion}|${fin}|${refrescoVivo}`
  const cargando = cargado !== pedido

  useEffect(() => {
    const control = new AbortController()
    const hasta = fin ?? Date.now()
    pedirHistorial(nodoId, hasta - VENTANA_MS, hasta, seleccion, control.signal)
      .then((h) => {
        setDatos(h)
        setError(null)
      })
      .catch((e: unknown) => !control.signal.aborted && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !control.signal.aborted && setCargado(pedido))
    return () => control.abort()
  }, [nodoId, seleccion, fin, refrescoVivo, pedido])

  const hasta = datos?.hasta ?? fin ?? ahora
  const desde = hasta - VENTANA_MS
  // La página anterior tiene sentido mientras esta no llegue al principio de los 14 días guardados
  const hayAnterior = desde > ahora - LIMITE_MS
  const irA = (nuevoFin: number) => setFin(nuevoFin >= Date.now() ? null : nuevoFin)
  const sensores = SENSORES.filter((s) => seleccion === null || s.id === seleccion)
  // Si la ventana abarca dos días, cada fila dice de qué día es
  const conDia = dia(desde, ahora) !== dia(hasta, ahora)

  return (
    <section className="tablas" aria-labelledby="tablas-titulo" data-cargando={cargando}>
      <header className="tablas-cabecera">
        <button type="button" className="tablas-flecha" aria-label="6 horas antes" disabled={!hayAnterior} onClick={() => irA(hasta - VENTANA_MS)}>
          <IconoFlecha hacia="izquierda" />
        </button>
        <div className="tablas-titulo">
          <h3 id="tablas-titulo">Lecturas</h3>
          <p aria-live="polite">
            {fechaHora(desde, ahora)} – {conDia ? fechaHora(hasta, ahora) : hora(hasta)}
            {fin === null && ' (ahora)'}
          </p>
        </div>
        <button type="button" className="tablas-flecha" aria-label="6 horas después" disabled={fin === null} onClick={() => irA(hasta + VENTANA_MS)}>
          <IconoFlecha hacia="derecha" />
        </button>
      </header>

      {error && (
        <p className="historial-error" role="alert">
          {error}
        </p>
      )}

      {/* key: al cambiar de sensor la grilla se monta de nuevo y entra con la animación de historial.css */}
      <div className="tablas-grilla" key={seleccion ?? 'todos'} data-una={seleccion !== null}>
        {sensores.map((s) => {
          const filas = [...(datos?.series[s.id] ?? [])].reverse()
          return (
            <table key={s.id} className="tabla">
              <caption>
                {/* El flex va adentro: un <caption> con display: flex deja de ir arriba de la tabla */}
                <span className="tabla-titulo">
                  <span className="grafico-clave" style={{ '--color': `var(${s.variable})` } as CSSProperties} />
                  {s.nombre}
                </span>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Hora</th>
                  <th scope="col">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(([t, v]) => (
                  <tr key={t}>
                    <td>{conDia ? fechaHora(t, ahora) : hora(t)}</td>
                    <td>{s.formato(v)}</td>
                  </tr>
                ))}
                {datos && filas.length === 0 && (
                  <tr>
                    <td colSpan={2} className="tabla-vacia">
                      Sin lecturas en estas 6 horas
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )
        })}
      </div>
    </section>
  )
}
