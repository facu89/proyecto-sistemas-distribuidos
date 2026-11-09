/**
 * Conexión con el servicio (software/servicio): la web no habla con el broker, recibe el estado
 * de los bancales por Server-Sent Events desde `/api/eventos`.
 *
 * - En producción el servicio sirve esta misma web, así que `/api` es el mismo origen.
 * - Con `pnpm dev`, Vite reenvía `/api` al servicio (ver `server.proxy` en vite.config.ts).
 */
import { useEffect, useState } from 'react'
import type { EstadoActuador, Instantanea, Nodo } from '../../../software/servicio/src/bancal.ts'
import type { Actuador, EstadoActuadores } from './estado'

// Los tipos vienen del servicio (import type: se borran al compilar, no se trae código de ahí).
// Así la forma de los datos se define en un solo lugar.
export type { EstadoActuador, Instantanea, Nodo }

const URL_EVENTOS = '/api/eventos'
/** Si el servicio no responde (está apagado), EventSource se rinde: se reintenta a mano cada tanto. */
const REINTENTO_MS = 3000

/** Parámetro de la URL con el nodo elegido (`?nodo=bancal2esp1`), así el link lleva a ese bancal. */
const PARAMETRO_NODO = 'nodo'

const leerNodoDeUrl = () => new URLSearchParams(window.location.search).get(PARAMETRO_NODO)

/** Guarda el nodo elegido en la URL sin agregar una entrada al historial. */
function escribirNodoEnUrl(nodoId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set(PARAMETRO_NODO, nodoId)
  window.history.replaceState(null, '', url)
}

/** Orden "natural": bancal2 antes que bancal10. */
const ordenNatural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** Prefijo de las alertas de nodo caído en `Instantanea.alertas` (tópico `alertas/nodo_offline/{nodoId}`). */
const ALERTA_OFFLINE = 'nodo_offline/'

export type Conexion = 'conectando' | 'conectada' | 'caida'

/** Lo que muestra el selector por cada bancal. */
export type ResumenNodo = {
  id: string
  presencia: Nodo['presencia']
  /** Si hay una alerta activa de este nodo (hoy, solo `nodo_offline`). */
  alerta: boolean
}

export function useBancal() {
  const [instantanea, setInstantanea] = useState<Instantanea | null>(null)
  const [conexion, setConexion] = useState<Conexion>('conectando')
  const [nodoElegido, setNodoElegido] = useState<string | null>(leerNodoDeUrl)

  useEffect(() => {
    let fuente: EventSource | null = null
    let reintento: ReturnType<typeof setTimeout> | undefined

    const abrir = () => {
      fuente = new EventSource(URL_EVENTOS)
      fuente.addEventListener('estado', (evento) => {
        setInstantanea(JSON.parse(evento.data) as Instantanea)
        setConexion('conectada')
      })
      fuente.onerror = () => {
        setConexion('caida')
        // Si se cortó una conexión que andaba, EventSource reconecta solo (readyState CONNECTING).
        // Si el servidor respondió con error (servicio apagado detrás del proxy de Vite), queda CLOSED.
        if (fuente?.readyState === EventSource.CLOSED) {
          fuente.close()
          reintento = setTimeout(abrir, REINTENTO_MS)
        }
      }
    }

    abrir()
    return () => {
      clearTimeout(reintento)
      fuente?.close()
    }
  }, [])

  const nodos = instantanea?.nodos ?? {}
  const alertas = instantanea?.alertas ?? {}

  // Los nodos que conoce el servicio y los que tienen una alerta retenida (un nodo caído puede tener
  // alerta aunque el servicio todavía no haya recibido nada de él).
  const ids = new Set(Object.keys(nodos))
  for (const clave of Object.keys(alertas)) {
    if (clave.startsWith(ALERTA_OFFLINE)) ids.add(clave.slice(ALERTA_OFFLINE.length))
  }
  const ordenados = [...ids].sort(ordenNatural)
  const nodoId = nodoElegido ?? ordenados[0] ?? 'bancal1esp1'
  // El elegido aparece en la lista aunque el servicio no lo conozca (por ejemplo, un ?nodo= mal escrito).
  if (!ids.has(nodoId)) ordenados.unshift(nodoId)

  const lista: ResumenNodo[] = ordenados.map((id) => ({
    id,
    presencia: nodos[id]?.presencia ?? null,
    alerta: alertas[ALERTA_OFFLINE + id]?.activa ?? false,
  }))

  const elegirNodo = (id: string) => {
    setNodoElegido(id)
    escribirNodoEnUrl(id)
  }

  return {
    conexion,
    /** Si el servicio está conectado al broker (false también mientras no hay datos). */
    broker: instantanea?.broker ?? false,
    umbrales: instantanea?.umbrales ?? null,
    /** Todos los bancales, para el selector. */
    lista,
    nodoId,
    nodo: nodos[nodoId] ?? null,
    elegirNodo,
  }
}

/** "bancal2esp1" → "Bancal 2". Si el id no sigue ese formato, se muestra tal cual. */
export function nombreBancal(nodoId: string): string {
  const numero = /^bancal(\d+)/i.exec(nodoId)?.[1]
  return numero ? `Bancal ${numero}` : nodoId
}

/**
 * Lo que se dibuja en la escena: el estado real que informó el ESP32 (`/estado`) y, mientras el
 * firmware no lo publique, lo último que ordenó el servicio (`/cmd`).
 */
export function estadoParaEscena(nodo: Nodo | null): EstadoActuadores {
  const valor = (a: Actuador) => {
    const estado = nodo?.actuadores[a]
    return estado?.real ?? estado?.ordenado ?? false
  }
  return { luz: valor('luz'), cooler: valor('cooler'), riego: valor('riego') }
}

/** El servicio ordenó algo y el ESP32 todavía informa otra cosa (solo cuando el firmware publique `/estado`). */
export const estaPendiente = (estado: EstadoActuador | undefined) =>
  estado?.real != null && estado.ordenado != null && estado.real !== estado.ordenado

/** "hace 3 s", "hace 2 min"... a partir de un instante en ms. */
export function hace(instante: number | null | undefined, ahora: number): string {
  if (instante == null) return 'nunca'
  const s = Math.max(0, Math.round((ahora - instante) / 1000))
  if (s < 60) return `hace ${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `hace ${min} min`
  return `hace ${Math.round(min / 60)} h`
}

/** Fuerza un render cada `cadaMs` para que los "hace N s" avancen. */
export function useAhora(cadaMs = 1000): number {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), cadaMs)
    return () => clearInterval(intervalo)
  }, [cadaMs])
  return ahora
}
