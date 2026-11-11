/**
 * Historial de lecturas para el dashboard de la web (`GET /api/historial`).
 *
 * Los datos los guarda EMQX, no el servicio: la regla `guardar_historial` (software/broker/config/emqx.conf)
 * escribe en la tabla `historial_lecturas` de MySQL una lectura por sensor cada 10 minutos y borra las de
 * más de 14 días. El servicio solo las lee, con su usuario de MySQL (mysql.ts).
 */
import type { RowDataPacket } from 'mysql2/promise'
import type { Historial, PedidoHistorial, Punto } from './historial-tipos.ts'
import type { Pool } from './mysql.ts'

export type { Historial, PedidoHistorial, Punto }

export type ConsultarHistorial = (pedido: PedidoHistorial) => Promise<Historial>

const HORA = 3_600_000
/** Sin `desde`, las últimas 24 horas. */
export const RANGO_POR_DEFECTO_MS = 24 * HORA
/** El historial guarda 14 días; se deja un día de margen para que "14 días" siempre entre. */
export const RANGO_MAXIMO_MS = 15 * 24 * HORA

const NOMBRE = /^[A-Za-z0-9_-]{1,100}$/

/** Valida los parámetros de `/api/historial?nodo=&desde=&hasta=&tipo=`. */
export function leerPedido(
  parametros: URLSearchParams,
  ahora: number,
): { ok: true; pedido: PedidoHistorial } | { ok: false; error: string } {
  const nodo = parametros.get('nodo') ?? ''
  if (!NOMBRE.test(nodo)) return { ok: false, error: 'Falta "nodo" o tiene caracteres inválidos' }

  const tipo = parametros.get('tipo')
  if (tipo !== null && !NOMBRE.test(tipo)) return { ok: false, error: '"tipo" tiene caracteres inválidos' }

  const instante = (nombre: string, porDefecto: number) => {
    const crudo = parametros.get(nombre)
    if (crudo === null || crudo === '') return porDefecto
    const valor = Number(crudo)
    return Number.isInteger(valor) && valor >= 0 ? valor : NaN
  }
  const hasta = instante('hasta', ahora)
  const desde = instante('desde', hasta - RANGO_POR_DEFECTO_MS)
  if (Number.isNaN(desde) || Number.isNaN(hasta)) {
    return { ok: false, error: '"desde" y "hasta" van en milisegundos desde 1970 (enteros)' }
  }
  if (desde >= hasta) return { ok: false, error: '"desde" tiene que ser anterior a "hasta"' }
  if (hasta - desde > RANGO_MAXIMO_MS) return { ok: false, error: 'El rango no puede pasar de 15 días' }

  return { ok: true, pedido: { nodo, desde, hasta, tipo } }
}

/** Consulta el historial con la conexión del servicio (mysql.ts). */
export function crearHistorial(pool: Pool): ConsultarHistorial {
  return async ({ nodo, desde, hasta, tipo }) => {
    const [filas] = await pool.query<RowDataPacket[]>(
      `SELECT tipo, ts, valor FROM historial_lecturas
       WHERE nodo = ? AND ts >= ? AND ts < ? ${tipo ? 'AND tipo = ?' : ''}
       ORDER BY ts`,
      [nodo, new Date(desde), new Date(hasta), ...(tipo ? [tipo] : [])],
    )
    const series: Record<string, Punto[]> = {}
    for (const fila of filas) {
      const serie = (series[fila.tipo as string] ??= [])
      serie.push([(fila.ts as Date).getTime(), Number(fila.valor)])
    }
    return { nodo, desde, hasta, series }
  }
}
