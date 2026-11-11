/**
 * Estado de los bancales en memoria y la lógica que lo une con las reglas.
 *
 * No sabe nada de MQTT ni de HTTP: recibe los mensajes ya separados en tópico y texto (`alMensaje`),
 * pide publicar órdenes con la función `publicar` que le pasan y avisa de cada cambio a quien escuche
 * (`alCambiar`). Así se prueba sin broker (bancal.test.ts) y main.ts solo conecta las piezas.
 */
import { ACTUADORES, decidir, minutoLocal, validarUmbrales, type Actuador, type Umbrales } from './reglas.ts'

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
  /** Lo que informó el ESP32 en `/estado` (`1`/`0`, retenido); `null` si nunca informó. */
  real: boolean | null
  instanteReal: number | null
}

export type Presencia = 'online' | 'offline'

/**
 * - `automatico`: el servicio ordena según las reglas (reglas.ts).
 * - `manual`: las reglas no ordenan nada; las órdenes llegan desde la web (`ordenarManual`).
 */
export type Modo = 'automatico' | 'manual'

export const MODOS: readonly Modo[] = ['automatico', 'manual']

export type Nodo = {
  /** Se guarda en MySQL (configuracion.ts): sobrevive a un reinicio del servicio. */
  modo: Modo
  /** Los rangos con que se aplican las reglas a este bancal: los propios o los de por defecto. */
  umbrales: Umbrales
  /** `true` si el bancal tiene rangos propios (cambiados desde la web); `false`, los de por defecto. */
  umbralesPropios: boolean
  /**
   * `true` si el bancal aplica las reglas él mismo (firmware que confirma la configuración en
   * `{nodo}/config/aplicada`): el servicio le manda el modo y los rangos y ya no ordena en automático.
   * `false` con firmware viejo: el servicio decide como antes.
   */
  reglasEnBancal: boolean
  config: {
    /** Versión de la última configuración publicada en `{nodo}/config`. */
    publicada: number | null
    /** Versión que el bancal confirmó que está usando. Si difiere de `publicada`, está pendiente. */
    aplicada: number | null
    /** Modo en que el bancal está funcionando de verdad (en automático si perdió el servicio). */
    efectivo: Modo | null
  }
  presencia: Presencia | null
  instantePresencia: number | null
  /** Por {tipo} de sensor: temperatura_suelo, temperatura_aire, humedad_aire, humedad_suelo, luz. */
  lecturas: Record<string, Lectura>
  actuadores: Record<Actuador, EstadoActuador>
}

/**
 * Una alerta de `alertas/...`, publicada (retenida) por el motor de reglas de EMQX:
 * - `alertas/nodo_offline/{nodo}`: `{"nodo", "activa", "desde"}`
 * - `alertas/servicio`: `{"activa", "motivo", "desde"}`
 */
export type Alerta = {
  activa: boolean
  /** Cuándo cambió, en ms desde 1970, según el broker; `null` si no vino. */
  desde: number | null
  /** El resto de los campos del JSON (`nodo`, `motivo`...). */
  datos: Record<string, unknown>
}

/** Lo que se le manda a la web (`/api/estado` y cada evento de `/api/eventos`). */
export type Instantanea = {
  /** Si el servicio está conectado al broker. */
  broker: boolean
  /** Los rangos por defecto (.env). Los de cada bancal están en `nodos[id].umbrales`. */
  umbrales: Umbrales
  nodos: Record<string, Nodo>
  /** Por tópico sin el `alertas/` inicial: `nodo_offline/bancal1esp1`, `servicio`... */
  alertas: Record<string, Alerta>
}

/** Modo y rangos de un bancal tal como se guardan. `umbrales: null` = los de por defecto del servicio. */
export type ConfigNodo = { modo: Modo; umbrales: Umbrales | null }

/**
 * Dónde se guarda la configuración de los bancales (configuracion.ts, en MySQL). Está definido acá y no
 * allá para que la web pueda importar los tipos de este archivo sin arrastrar mysql2.
 */
export type Almacen = {
  cargar(): Promise<Record<string, ConfigNodo>>
  guardar(nodoId: string, config: ConfigNodo): Promise<void>
}

export type Publicar = (nodoId: string, actuador: Actuador, encendido: boolean) => Promise<void>

/** Resultado de un pedido de la web. `codigo` es el estado HTTP con que se responde si falla. */
export type Resultado = { ok: true } | { ok: false; codigo: 400 | 404 | 409 | 503; error: string }

type Opciones = {
  /** Los rangos por defecto, para los bancales que no tienen propios. */
  umbrales: Umbrales
  publicar: Publicar
  /** Publica la configuración de un bancal en `{nodo}/config` (retenida). Sin esto no se publica. */
  publicarConfig?: (nodoId: string, json: string) => Promise<void>
  /** Zona horaria POSIX que se le manda al bancal para el horario de la luz. */
  zonaPosix?: string
  /** Dónde se guardan el modo y los rangos de cada bancal (MySQL). Sin almacén, quedan solo en memoria. */
  almacen?: Almacen | null
  /** Zona horaria del horario de la luz. */
  zonaHoraria?: string
  log?: (mensaje: string) => void
  ahora?: () => number
}

export function crearBancales({
  umbrales,
  publicar,
  publicarConfig,
  zonaPosix = '<-03>3',
  almacen = null,
  zonaHoraria = 'America/Argentina/Buenos_Aires',
  log = () => {},
  ahora = Date.now,
}: Opciones) {
  const nodos: Record<string, Nodo> = {}
  /** Lo que estaba guardado en MySQL, para los bancales que todavía no mandaron nada desde el arranque. */
  let guardada: Record<string, ConfigNodo> = {}
  const alertas: Record<string, Alerta> = {}
  let broker = false
  const oyentes = new Set<(instantanea: Instantanea) => void>()

  const instantanea = (): Instantanea => ({ broker, umbrales, nodos, alertas })
  const avisar = () => {
    const actual = instantanea()
    for (const oyente of oyentes) oyente(actual)
  }

  function nodo(id: string): Nodo {
    const config = guardada[id]
    nodos[id] ??= {
      // Con lo guardado en MySQL; un bancal nuevo arranca en automático y con los rangos por defecto
      modo: config?.modo ?? 'automatico',
      umbrales: config?.umbrales ?? umbrales,
      umbralesPropios: (config?.umbrales ?? null) !== null,
      reglasEnBancal: false,
      config: { publicada: null, aplicada: null, efectivo: null },
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
    const n = nodo(nodoId)
    n.lecturas[tipo] = { valor: aNumero(texto), instante: ahora() }
    // En manual las lecturas se guardan (la web las muestra) pero no ordenan nada.
    if (n.modo === 'automatico') aplicarRegla(nodoId, tipo, `${tipo}=${texto}`)
    return true
  }

  /** Aplica la regla del sensor `tipo` con su última lectura y, si corresponde, ordena. */
  function aplicarRegla(nodoId: string, tipo: string, motivo: string) {
    const n = nodo(nodoId)
    // El bancal decide solo: el servicio no le manda órdenes en automático (se pisarían)
    if (n.reglasEnBancal) return
    const lectura = n.lecturas[tipo]
    const decision = decidir(
      tipo,
      lectura?.valor ?? null,
      (a) => n.actuadores[a].ordenado,
      n.umbrales,
      minutoLocal(ahora(), zonaHoraria),
    )
    if (!decision) return

    const estadoActuador = n.actuadores[decision.actuador]
    // Se publica cuando cambia la decisión, o si el actuador informó un estado real distinto al deseado
    const cambioDecision = decision.encendido !== estadoActuador.ordenado
    const discrepaConReal = estadoActuador.real !== null && estadoActuador.real !== decision.encendido

    if (cambioDecision || discrepaConReal) {
      ordenar(nodoId, decision.actuador, decision.encendido, motivo)
    }
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
      enviarConfig(nodoId)
      // Si el bancal aplica las reglas, solo se le reenvían las órdenes manuales
      if (n.reglasEnBancal && n.modo !== 'manual') return true
      for (const actuador of ACTUADORES) {
        const ordenado = n.actuadores[actuador].ordenado
        if (ordenado !== null) ordenar(nodoId, actuador, ordenado, 'reenvío: el nodo se conectó')
      }
    }
    return true
  }

  /**
   * Publica en `{nodo}/config` el modo y los rangos del bancal (retenida). La "v" es una marca de tiempo
   * creciente: el bancal la devuelve en `config/aplicada` y así se sabe si ya aplicó la última.
   */
  function enviarConfig(nodoId: string) {
    if (!publicarConfig) return
    const n = nodo(nodoId)
    const u = n.umbrales
    const v = Math.max(ahora(), (n.config.publicada ?? 0) + 1)
    const json = JSON.stringify({
      v,
      modo: n.modo,
      riego: [u.riegoEncenderDebajoDe, u.riegoApagarDesde],
      cooler: [u.ventiladorEncenderDesde, u.ventiladorApagarDebajoDe],
      luz: u.luzHorario ? [u.luzHorario.desde, u.luzHorario.hasta] : null,
      tz: zonaPosix,
    })
    n.config.publicada = v
    publicarConfig(nodoId, json).catch((error: unknown) =>
      log(`No se pudo publicar la configuración de ${nodoId}: ${error instanceof Error ? error.message : error}`),
    )
  }

  /** `{nodo}/config/aplicada`: `{"v", "modo", "efectivo"}`. El bancal tiene firmware que aplica las reglas. */
  function alConfigAplicada(nodoId: string, texto: string): boolean {
    let json: { v?: unknown; efectivo?: unknown }
    try {
      json = JSON.parse(texto)
    } catch {
      return false
    }
    const n = nodo(nodoId)
    if (!n.reglasEnBancal) log(`${nodoId} aplica las reglas en el bancal: el servicio le manda la configuración`)
    n.reglasEnBancal = true
    n.config.aplicada = typeof json.v === 'number' ? json.v : null
    n.config.efectivo = esModo(json.efectivo) ? json.efectivo : null
    return true
  }

  /** `clave` es el tópico sin `alertas/`. Un payload vacío borra el retenido: la alerta deja de existir. */
  function alAlerta(clave: string, texto: string): boolean {
    if (texto === '') {
      if (!(clave in alertas)) return false
      delete alertas[clave]
      return true
    }
    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      log(`Alerta alertas/${clave} con un payload que no es JSON: ${texto}`)
      return false
    }
    if (typeof json !== 'object' || json === null || typeof (json as { activa?: unknown }).activa !== 'boolean') {
      log(`Alerta alertas/${clave} sin el campo "activa": ${texto}`)
      return false
    }
    const { activa, desde, ...datos } = json as Record<string, unknown>
    const antes = alertas[clave]
    if (antes && antes.activa !== activa) log(`Alerta ${clave}: ${activa ? 'activa' : 'resuelta'}`)
    alertas[clave] = { activa: activa as boolean, desde: typeof desde === 'number' ? desde : null, datos }
    return true
  }

  /** Vuelve a aplicar todas las reglas del bancal con sus últimas lecturas (solo en automático). */
  function reaplicar(nodoId: string, motivo: string) {
    const n = nodo(nodoId)
    if (n.modo !== 'automatico') return
    for (const tipo of Object.keys(n.lecturas)) aplicarRegla(nodoId, tipo, `${motivo}, ${tipo}`)
  }

  /**
   * Guarda el modo y los rangos del bancal en MySQL. Se guarda ANTES de aplicar el cambio: si MySQL no
   * responde, el pedido falla y la web no muestra algo que se perdería en el próximo reinicio.
   */
  async function guardar(nodoId: string, config: ConfigNodo): Promise<Resultado> {
    if (!almacen) return { ok: true }
    try {
      await almacen.guardar(nodoId, config)
      guardada[nodoId] = config
      return { ok: true }
    } catch (error) {
      log(`No se pudo guardar la configuración de ${nodoId}: ${error instanceof Error ? error.message : error}`)
      return { ok: false, codigo: 503, error: 'No se pudo guardar el cambio en la base de datos. Probá de nuevo en un rato.' }
    }
  }

  const configDe = (n: Nodo): ConfigNodo => ({ modo: n.modo, umbrales: n.umbralesPropios ? n.umbrales : null })

  return {
    /**
     * Toma el modo y los rangos guardados en MySQL (al arrancar, o cuando MySQL vuelve). Los bancales que
     * ya están en memoria se actualizan y, si quedan en automático, se les vuelven a aplicar las reglas.
     */
    cargarConfiguracion(config: Record<string, ConfigNodo>) {
      guardada = config
      for (const [id, n] of Object.entries(nodos)) {
        const c = config[id]
        if (!c) continue
        n.modo = c.modo
        n.umbrales = c.umbrales ?? umbrales
        n.umbralesPropios = c.umbrales !== null
        enviarConfig(id)
        reaplicar(id, 'configuración guardada')
      }
      avisar()
    },

    /** Procesa un mensaje de `+/sensor/+`, `+/actuador/+/estado`, `+/presencia` o `alertas/#`. */
    alMensaje(topico: string, texto: string) {
      const partes = topico.split('/')
      const [nodoId, seccion, tipo, sufijo] = partes
      const valor = texto.trim()
      if (!nodoId) return

      let cambio = false
      if (nodoId === 'alertas') {
        const clave = partes.slice(1).join('/')
        if (clave) cambio = alAlerta(clave, valor)
      } else if (partes.length === 3 && seccion === 'sensor' && tipo) cambio = alSensor(nodoId, tipo, valor)
      else if (partes.length === 3 && seccion === 'config' && tipo === 'aplicada') cambio = alConfigAplicada(nodoId, valor)
      else if (partes.length === 4 && seccion === 'actuador' && sufijo === 'estado' && esActuador(tipo))
        cambio = alEstado(nodoId, tipo, valor)
      else if (partes.length === 2 && seccion === 'presencia') cambio = alPresencia(nodoId, valor)

      if (cambio) avisar()
    },

    /**
     * Cambia entre automático y manual. Al volver a automático se aplican enseguida las reglas con
     * las últimas lecturas, sin esperar la próxima. Entre los umbrales de prender y apagar (histéresis)
     * el actuador sigue como lo dejó el modo manual.
     */
    async setModo(nodoId: string, modo: Modo): Promise<Resultado> {
      const n = nodos[nodoId]
      if (!n) return { ok: false, codigo: 404, error: `No se conoce el nodo ${nodoId}` }
      if (n.modo === modo) return { ok: true }
      const guardado = await guardar(nodoId, { ...configDe(n), modo })
      if (!guardado.ok) return guardado
      n.modo = modo
      log(`${nodoId}: modo ${modo}`)
      enviarConfig(nodoId)
      reaplicar(nodoId, 'vuelta a automático')
      avisar()
      return { ok: true }
    },

    /**
     * Cambia los rangos de un bancal; `null` vuelve a los de por defecto. Se validan, se guardan y, en
     * automático, se aplican enseguida con las últimas lecturas (sin esperar la próxima).
     */
    async setUmbrales(nodoId: string, nuevos: Umbrales | null): Promise<Resultado> {
      const n = nodos[nodoId]
      if (!n) return { ok: false, codigo: 404, error: `No se conoce el nodo ${nodoId}` }
      if (nuevos !== null) {
        const problema = validarUmbrales(nuevos)
        if (problema) return { ok: false, codigo: 400, error: problema }
      }
      const guardado = await guardar(nodoId, { modo: n.modo, umbrales: nuevos })
      if (!guardado.ok) return guardado
      n.umbrales = nuevos ?? umbrales
      n.umbralesPropios = nuevos !== null
      log(`${nodoId}: rangos ${nuevos === null ? 'por defecto' : JSON.stringify(nuevos)}`)
      enviarConfig(nodoId)
      reaplicar(nodoId, 'rangos nuevos')
      avisar()
      return { ok: true }
    },

    /** Orden pedida desde la web. Solo se acepta con el nodo en manual. */
    ordenarManual(nodoId: string, actuador: Actuador, encendido: boolean): Resultado {
      const n = nodos[nodoId]
      if (!n) return { ok: false, codigo: 404, error: `No se conoce el nodo ${nodoId}` }
      if (n.modo !== 'manual') {
        return { ok: false, codigo: 409, error: `${nodoId} está en automático: pasalo a manual para manejar los actuadores` }
      }
      ordenar(nodoId, actuador, encendido, 'manual')
      avisar()
      return { ok: true }
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

export const esActuador = (tipo: string): tipo is Actuador => (ACTUADORES as readonly string[]).includes(tipo)

export const esModo = (texto: unknown): texto is Modo => (MODOS as readonly unknown[]).includes(texto)

/** "41.2" -> 41.2; "nan", vacío o cualquier cosa que no sea un número -> null. */
function aNumero(texto: string): number | null {
  if (texto === '') return null
  const valor = Number(texto)
  return Number.isFinite(valor) ? valor : null
}
