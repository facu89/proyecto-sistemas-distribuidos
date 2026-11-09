/**
 * Datos del dashboard: qué sensores hay, cómo se piden al servicio (`GET /api/historial`) y cómo se
 * acomodan para uPlot.
 */
import type { Historial, Punto } from '../../../../software/servicio/src/historial-tipos.ts'

export type { Historial, Punto }

export type TipoSensor = 'temperatura_suelo' | 'temperatura_aire' | 'humedad_aire' | 'humedad_suelo' | 'luz'
export type Grupo = 'temperatura' | 'humedad' | 'luz'

export type Sensor = {
  id: TipoSensor
  nombre: string
  /** Para el selector, donde no entra el nombre largo. */
  corto: string
  grupo: Grupo
  /** Variable CSS con el color de la línea (historial.css; la paleta está validada, ver ahí). */
  variable: string
  formato: (valor: number) => string
}

/**
 * Orden fijo: define el color de cada sensor y no cambia con el filtro (el color sigue al sensor, no a
 * la posición). Las dos temperaturas y las dos humedades, que se dibujan juntas, son pares de la
 * paleta que se distinguen también con daltonismo.
 */
export const SENSORES: Sensor[] = [
  { id: 'temperatura_suelo', nombre: 'Temperatura del suelo', corto: 'Temp. suelo', grupo: 'temperatura', variable: '--serie-1', formato: (v) => `${v.toFixed(1)} °C` },
  { id: 'temperatura_aire', nombre: 'Temperatura del aire', corto: 'Temp. aire', grupo: 'temperatura', variable: '--serie-2', formato: (v) => `${v.toFixed(1)} °C` },
  { id: 'humedad_aire', nombre: 'Humedad del aire', corto: 'Hum. aire', grupo: 'humedad', variable: '--serie-3', formato: (v) => `${Math.round(v)} %` },
  { id: 'humedad_suelo', nombre: 'Humedad del suelo', corto: 'Hum. suelo', grupo: 'humedad', variable: '--serie-4', formato: (v) => `${Math.round(v)} %` },
  { id: 'luz', nombre: 'Luz', corto: 'Luz', grupo: 'luz', variable: '--serie-luz', formato: (v) => (v >= 0.5 ? 'Hay luz' : 'Oscuro') },
]

export const sensor = (id: TipoSensor) => SENSORES.find((s) => s.id === id)!

export const HORA = 3_600_000
export const MINUTO = 60_000

/** Si entre dos lecturas de un sensor pasa más que esto, la línea se corta (el ESP32 estuvo apagado). */
export const HUECO_MS = 25 * MINUTO

export async function pedirHistorial(
  nodo: string,
  desde: number,
  hasta: number,
  tipo: TipoSensor | null = null,
  senal?: AbortSignal,
): Promise<Historial> {
  const parametros = new URLSearchParams({ nodo, desde: String(Math.floor(desde)), hasta: String(Math.ceil(hasta)) })
  if (tipo) parametros.set('tipo', tipo)
  let respuesta: Response
  try {
    respuesta = await fetch(`/api/historial?${parametros}`, { signal: senal })
  } catch (error) {
    if (senal?.aborted) throw error
    throw new Error('No se pudo contactar al servicio')
  }
  if (!respuesta.ok) {
    const datos = (await respuesta.json().catch(() => null)) as { error?: string } | null
    throw new Error(datos?.error ?? `El servicio respondió ${respuesta.status}`)
  }
  return (await respuesta.json()) as Historial
}

/**
 * uPlot necesita un solo eje X compartido. Cada lectura guardada lleva su propia hora, pero los cinco
 * sensores llegan en la misma tanda (con milisegundos de diferencia), así que se agrupan las que caen
 * dentro de un minuto de la primera de la tanda.
 *
 * En cada serie, `undefined` es "este sensor no tiene lectura en esta tanda" (uPlot la une igual) y
 * `null` es un hueco de verdad: pasaron más de HUECO_MS sin lecturas y la línea se corta.
 *
 * Devuelve `[xs en segundos, ...una serie por id, en el orden pedido]`.
 */
export function alinear(series: Historial['series'], ids: TipoSensor[]): (number | null | undefined)[][] {
  const todos = ids.flatMap((id, i) => (series[id] ?? []).map(([t, v]) => ({ t, v, i })))
  todos.sort((a, b) => a.t - b.t)

  const xs: number[] = []
  const ys: (number | null | undefined)[][] = ids.map(() => [])
  let inicioTanda = -Infinity
  for (const { t, v, i } of todos) {
    if (t - inicioTanda > MINUTO || ys[i][xs.length - 1] !== undefined) {
      inicioTanda = t
      xs.push(t / 1000)
      for (const y of ys) y.push(undefined)
    }
    ys[i][xs.length - 1] = v
  }

  // Huecos: un null justo después de la última lectura antes de un corte largo
  for (const y of ys) {
    let anterior: number | null = null
    for (let k = 0; k < xs.length; k++) {
      if (y[k] === undefined) continue
      if (anterior !== null && (xs[k] - xs[anterior]) * 1000 > HUECO_MS && k - anterior > 1) y[anterior + 1] = null
      anterior = k
    }
  }
  return [xs, ...ys]
}

/** Tramos sin luz (luz = 0), en ms, para sombrear la noche detrás de las líneas. */
export function noches(luz: Punto[] | undefined): [desde: number, hasta: number][] {
  const tramos: [number, number][] = []
  if (!luz) return tramos
  let inicio: number | null = null
  for (let k = 0; k < luz.length; k++) {
    const [t, v] = luz[k]
    const siguiente = luz[k + 1]?.[0]
    if (v >= 0.5) {
      // Volvió la luz: el tramo oscuro termina acá
      if (inicio !== null) tramos.push([inicio, t])
      inicio = null
    } else {
      inicio ??= t
      // Última lectura o un hueco después: el tramo cubre los 10 minutos de esta lectura y se corta
      if (siguiente === undefined || siguiente - t > HUECO_MS) {
        tramos.push([inicio, t + 10 * MINUTO])
        inicio = null
      }
    }
  }
  return tramos
}

const formatoHora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
const formatoDia = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

export const hora = (ms: number) => formatoHora.format(ms)

/** "hoy", "ayer" o "dom 8 nov". */
export function dia(ms: number, ahora = Date.now()): string {
  const inicioHoy = new Date(ahora).setHours(0, 0, 0, 0)
  if (ms >= inicioHoy) return 'hoy'
  if (ms >= inicioHoy - 24 * HORA) return 'ayer'
  return formatoDia.format(ms).replace(/[.,]/g, '')
}

/** Las medianoches (hora local) entre `desde` y `hasta`, cada `cadaDias` días. */
export function medianoches(desde: number, hasta: number, cadaDias: number): number[] {
  const fecha = new Date(desde)
  if (fecha.getHours() || fecha.getMinutes() || fecha.getSeconds() || fecha.getMilliseconds()) {
    fecha.setHours(24, 0, 0, 0)
  }
  const marcas: number[] = []
  while (fecha.getTime() <= hasta) {
    marcas.push(fecha.getTime())
    fecha.setDate(fecha.getDate() + cadaDias)
  }
  return marcas
}

export const fechaHora = (ms: number, ahora = Date.now()) => `${dia(ms, ahora)} ${hora(ms)}`
