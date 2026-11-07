/**
 * Estado de los bancales en memoria y la lógica que lo une con las reglas.
 *
 * No sabe nada de MQTT ni de HTTP: recibe los mensajes ya separados en tópico y texto (`alMensaje`),
 * pide publicar órdenes con la función `publicar` que le pasan y avisa de cada cambio a quien escuche
 * (`alCambiar`). Así se prueba sin broker (bancal.test.ts) y main.ts solo conecta las piezas.
 */
import { ACTUADORES, decidir, type Actuador, type Umbrales } from './reglas.ts'

export type Lectura = {
  /** `null` si el ESP32 publicó "nan" (el sensor no respondió). */
  valor: number | null
  /** Cuándo llegó, en ms desde 1970 (Date.now()). */
  instante: number
}

export type EstadoActuador = {
  /** Lo último que ordenó el servicio en `/cmd`; `null` si todavía no ordenó nada. */
  ordenado: boolean | null
  instanteOrden: number | null
  /**
   * Lo que informó el ESP32 en `/estado`; `null` si nunca informó. Por ahora el firmware no lo
   * publica (todavía no hay actuadores conectados), así que queda en `null`.
   */
  real: boolean | null
  instanteReal: number | null
}

export type Presencia = 'online' | 'offline'

export type Nodo = {
  presencia: Presencia | null
  instantePresencia: number | null
  /** Por {tipo} de sensor: temperatura_suelo, temperatura_aire, humedad_aire, humedad_suelo, luz. */
  lecturas: Record<string, Lectura>
  actuadores: Record<Actuador, EstadoActuador>
}

/** Lo que se le manda a la web (`/api/estado` y cada evento de `/api/eventos`). */
export type Instantanea = {
  /** Si el servicio está conectado al broker. */
  broker: boolean
  umbrales: Umbrales
  nodos: Record<string, Nodo>
}

export type Publicar = (nodoId: string, actuador: Actuador, encendido: boolean) => Promise<void>

type Opciones = {
  umbrales: Umbrales
  publicar: Publicar
  log?: (mensaje: string) => void
  ahora?: () => number
}

export function crearBancales({ umbrales, publicar, log = () => {}, ahora = Date.now }: Opciones) {
  const nodos: Record<string, Nodo> = {}
  let broker = false
  const oyentes = new Set<(instantanea: Instantanea) => void>()

  const instantanea = (): Instantanea => ({ broker, umbrales, nodos })
  const avisar = () => {
    const actual = instantanea()
    for (const oyente of oyentes) oyente(actual)
  }

  function nodo(id: string): Nodo {
    nodos[id] ??= {
      presencia: null,
      instantePresencia: null,
      lecturas: {},
      actuadores: Object.fromEntries(
        ACTUADORES.map((a) => [a, { ordenado: null, instanteOrden: null, real: null, instanteReal: null }]),
      ) as Record<Actuador, EstadoActuador>,
    }
    return nodos[id]
  }

  /** Publica la orden y la anota. Si la publicación falla, el estado vuelve a "sin orden" para reintentar. */
  function ordenar(nodoId: string, actuador: Actuador, encendido: boolean, motivo: string) {
    const estado = nodo(nodoId).actuadores[actuador]
    estado.ordenado = encendido
    estado.instanteOrden = ahora()
    log(`${nodoId}/${actuador} -> ${encendido ? '1' : '0'} (${motivo})`)
    publicar(nodoId, actuador, encendido).catch((error: unknown) => {
      log(`No se pudo publicar ${nodoId}/${actuador}: ${error instanceof Error ? error.message : error}`)
      if (estado.ordenado === encendido) {
        estado.ordenado = null
        estado.instanteOrden = null
        avisar()
      }
    })
  }

  function alSensor(nodoId: string, tipo: string, texto: string): boolean {
    const valor = aNumero(texto)
    const n = nodo(nodoId)
    n.lecturas[tipo] = { valor, instante: ahora() }

    const decision = decidir(tipo, valor, (a) => n.actuadores[a].ordenado, umbrales)
    // Solo se publica cuando cambia la decisión, no con cada lectura (llegan cada 5 s).
    if (decision && decision.encendido !== n.actuadores[decision.actuador].ordenado) {
      ordenar(nodoId, decision.actuador, decision.encendido, `${tipo}=${texto}`)
    }
    return true
  }

  function alEstado(nodoId: string, actuador: Actuador, texto: string): boolean {
    if (texto !== '1' && texto !== '0') return false
    const estado = nodo(nodoId).actuadores[actuador]
    const real = texto === '1'
    if (estado.real === real) return false
    estado.real = real
    estado.instanteReal = ahora()
    return true
  }

  function alPresencia(nodoId: string, texto: string): boolean {
    if (texto !== 'online' && texto !== 'offline') return false
    const n = nodo(nodoId)
    const antes = n.presencia
    n.presencia = texto
    n.instantePresencia = ahora()
    if (antes !== texto) log(`${nodoId} ${texto}`)

    // El ESP32 no recuerda las órdenes al reiniciarse y /cmd no es retenido: cada vez que se
    // conecta (publica "online") se le reenvían las órdenes vigentes.
    if (texto === 'online') {
      for (const actuador of ACTUADORES) {
        const ordenado = n.actuadores[actuador].ordenado
        if (ordenado !== null) ordenar(nodoId, actuador, ordenado, 'reenvío: el nodo se conectó')
      }
    }
    return true
  }

  return {
    /** Procesa un mensaje de `+/sensor/+`, `+/actuador/+/estado` o `+/presencia`. */
    alMensaje(topico: string, texto: string) {
      const partes = topico.split('/')
      const [nodoId, seccion, tipo, sufijo] = partes
      const valor = texto.trim()
      if (!nodoId) return

      let cambio = false
      if (partes.length === 3 && seccion === 'sensor' && tipo) cambio = alSensor(nodoId, tipo, valor)
      else if (partes.length === 4 && seccion === 'actuador' && sufijo === 'estado' && esActuador(tipo))
        cambio = alEstado(nodoId, tipo, valor)
      else if (partes.length === 2 && seccion === 'presencia') cambio = alPresencia(nodoId, valor)

      if (cambio) avisar()
    },

    setBroker(conectado: boolean) {
      if (broker === conectado) return
      broker = conectado
      avisar()
    },

    instantanea,

    /** Avisa con la instantánea completa en cada cambio. Devuelve la función para dejar de escuchar. */
    alCambiar(oyente: (instantanea: Instantanea) => void) {
      oyentes.add(oyente)
      return () => oyentes.delete(oyente)
    },
  }
}

export type Bancales = ReturnType<typeof crearBancales>

const esActuador = (tipo: string): tipo is Actuador => (ACTUADORES as readonly string[]).includes(tipo)

/** "41.2" -> 41.2; "nan", vacío o cualquier cosa que no sea un número -> null. */
function aNumero(texto: string): number | null {
  if (texto === '') return null
  const valor = Number(texto)
  return Number.isFinite(valor) ? valor : null
}
