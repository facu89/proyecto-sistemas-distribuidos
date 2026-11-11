/**
 * El ESP32 simulado completo: el bancal (reglas), el modelo de los sensores y la conexión MQTT, con lo que
 * hace falta para manejarlo desde el panel (panel.ts):
 *
 * - fijar un sensor en un valor (el resto sigue simulado) y soltarlo;
 * - conectar y desconectar del broker, como enchufar y desenchufar la placa;
 * - conectarse sin el certificado y la clave privada del cliente, o sin la contraseña MQTT, para ver en qué
 *   paso lo rechaza el broker.
 */
import fs from 'node:fs'
import mqtt, { type MqttClient } from 'mqtt'
import { CONFIG_POR_DEFECTO, crearBancal, minutoEnZona, type Configuracion } from './bancal.ts'
import { avanzar, estadoInicial, type Sensores } from './modelo.ts'

export type Opciones = {
  nodo: string
  url: string
  password: string
  /** Rutas de la CA del broker y del certificado y la clave privada del cliente. */
  ca: string
  cert: string
  key: string
  /** Dónde se guarda la última configuración (la "NVS"). */
  estado: string
  intervaloMs: number
}

export type Sensor = keyof Sensores
export const LIMITES: Record<Sensor, [number, number]> = {
  temperaturaAire: [0, 50],
  humedadAire: [0, 100],
  temperaturaSuelo: [0, 50],
  humedadSuelo: [0, 100],
  luz: [0, 1],
}
const ACTUADORES = ['luz', 'cooler', 'riego'] as const

/** En qué paso falló la conexión: llegar al broker, el saludo TLS o el usuario y la contraseña. */
export type Fallo = { etapa: 'red' | 'tls' | 'mqtt'; mensaje: string; explicacion: string }
export type Muestra = { t: number; s: Sensores; a: Record<(typeof ACTUADORES)[number], boolean> }
export type Evento = { tipo: 'estado' | 'muestra' | 'log'; datos: unknown }

const HISTORIA_MS = 30 * 60_000
const LOGS = 300

export function crearSimulador(o: Opciones) {
  const oyentes = new Set<(e: Evento) => void>()
  const emitir = (tipo: Evento['tipo'], datos: unknown) => oyentes.forEach((f) => f({ tipo, datos }))

  const logs: { t: number; texto: string }[] = []
  const log = (texto: string) => {
    const linea = { t: Date.now(), texto }
    console.log(`[${new Date(linea.t).toLocaleTimeString('es-AR', { hour12: false })}] ${texto}`)
    logs.push(linea)
    if (logs.length > LOGS) logs.shift()
    emitir('log', linea)
  }

  // La "NVS": la última configuración recibida, para arrancar con ella aunque no haya broker
  function configGuardada(): Configuracion {
    try {
      return JSON.parse(fs.readFileSync(o.estado, 'utf8')) as Configuracion
    } catch {
      return CONFIG_POR_DEFECTO
    }
  }

  // ---- Conexión ----
  let cliente: MqttClient | null = null
  const conexion = {
    /** Lo que pide el panel: el simulador reintenta solo mientras sea true. */
    deseada: true,
    /** Presentar el certificado de cliente (y su clave privada) en el saludo TLS. */
    certificado: true,
    /** Mandar la contraseña MQTT. */
    clave: true,
    estado: 'desconectado' as 'desconectado' | 'conectando' | 'conectado' | 'rechazado',
    fallo: null as Fallo | null,
    servicio: false,
    desde: Date.now(),
  }
  const pasar = (estado: typeof conexion.estado) => {
    if (conexion.estado !== estado) conexion.desde = Date.now()
    conexion.estado = estado
  }
  const publicar = (topico: string, valor: string, retenido: boolean) =>
    cliente?.connected && cliente.publish(`${o.nodo}/${topico}`, valor, retenido ? { qos: 1, retain: true } : { qos: 0 })

  const desdeActuador = { luz: Date.now(), cooler: Date.now(), riego: Date.now() }
  const bancal = crearBancal(
    {
      estado: (a, prendido) => {
        desdeActuador[a] = Date.now()
        publicar(`actuador/${a}/estado`, prendido ? '1' : '0', true)
        emitirEstado()
      },
      aplicada: (json) => publicar('config/aplicada', json, true),
      log,
    },
    configGuardada(),
  )

  function clasificar(e: Error & { code?: unknown }): Fallo {
    const mensaje = (e.message || String(e.code ?? e)).trim()
    if (typeof e.code === 'number') {
      return {
        etapa: 'mqtt',
        mensaje,
        explicacion: conexion.clave
          ? 'El saludo TLS pasó, pero el broker rechazó la sesión MQTT (usuario, contraseña o client ID).'
          : 'El saludo TLS pasó (el certificado es válido), pero sin la contraseña el broker rechaza la sesión MQTT: el certificado solo no alcanza.',
      }
    }
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|connack timeout/i.test(`${e.code} ${mensaje}`)) {
      return { etapa: 'red', mensaje, explicacion: 'No se llegó al broker: está apagado, o no hay red o DNS.' }
    }
    return {
      etapa: 'tls',
      mensaje,
      explicacion: conexion.certificado
        ? 'Falló el saludo TLS con el broker.'
        : 'El broker cortó el saludo TLS: exige un certificado de cliente firmado por su CA (TLS mutuo). Sin la clave privada no se llega ni a mandar el usuario y la contraseña.',
    }
  }

  function soltarCliente() {
    const c = cliente
    if (!c) return
    cliente = null
    c.removeAllListeners()
    c.on('error', () => {})
    // Corte en seco, sin DISCONNECT: como desenchufar la placa. El broker publica el Last Will ("offline").
    c.end(true)
    conexion.servicio = false
    bancal.alServicio(false, Date.now())
  }

  function conectar() {
    soltarCliente()
    conexion.fallo = null
    pasar('conectando')
    let tls: { ca: Buffer; cert?: Buffer; key?: Buffer }
    try {
      tls = { ca: fs.readFileSync(o.ca) }
      if (conexion.certificado) Object.assign(tls, { cert: fs.readFileSync(o.cert), key: fs.readFileSync(o.key) })
    } catch (e) {
      conexion.fallo = { etapa: 'tls', mensaje: (e as Error).message, explicacion: 'No se pudieron leer los certificados (ver MQTT_CA, MQTT_CERT y MQTT_KEY en .env).' }
      pasar('rechazado')
      log(`No se pudo conectar: ${conexion.fallo.mensaje}`)
      return emitirEstado()
    }
    log(`Conectando a ${o.url} ${conexion.certificado ? 'con' : 'SIN'} certificado de cliente y ${conexion.clave ? 'con' : 'SIN'} contraseña`)
    const c = mqtt.connect(o.url, {
      // Como la placa: el client ID es el usuario (EMQX lo exige) y el usuario es el CN del certificado
      clientId: o.nodo,
      username: o.nodo,
      password: conexion.clave ? o.password : undefined,
      ...tls,
      rejectUnauthorized: true,
      clean: true,
      keepalive: 20, // como la placa (firmware/src/red.cpp)
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      will: { topic: `${o.nodo}/presencia`, payload: Buffer.from('offline'), qos: 1, retain: true },
    })
    cliente = c
    c.on('connect', () => {
      conexion.fallo = null
      pasar('conectado')
      log(`Conectado a ${o.url} como "${o.nodo}"`)
      c.publish(`${o.nodo}/presencia`, 'online', { qos: 1, retain: true })
      c.subscribe([`${o.nodo}/actuador/+/cmd`, `${o.nodo}/config`, 'servicio/conexion'], { qos: 1 })
      bancal.alConectar()
      emitirEstado()
    })
    c.on('error', (e) => {
      const antes = conexion.fallo?.mensaje
      conexion.fallo = clasificar(e)
      pasar('rechazado')
      // Reintenta cada 5 s: el mismo rechazo se anota una sola vez
      if (conexion.fallo.mensaje !== antes) log(`Conexión rechazada (${conexion.fallo.etapa}): ${conexion.fallo.mensaje}`)
      emitirEstado()
    })
    c.on('close', () => {
      if (conexion.estado === 'conectado') {
        log('Se cortó la conexión con el broker')
        pasar('conectando')
      } else if (!conexion.fallo) {
        // El broker cerró sin decir por qué antes de aceptar la sesión
        conexion.fallo = clasificar(new Error('el broker cerró la conexión antes de aceptar la sesión'))
        pasar('rechazado')
        log(`Conexión rechazada (${conexion.fallo.etapa}): ${conexion.fallo.mensaje}`)
      }
      conexion.servicio = false
      bancal.alServicio(false, Date.now())
      emitirEstado()
    })
    c.on('message', (topico, mensaje) => {
      const texto = mensaje.toString('utf8')
      const ahora = Date.now()
      if (topico === 'servicio/conexion') {
        conexion.servicio = texto === 'online'
        bancal.alServicio(conexion.servicio, ahora)
      } else if (topico === `${o.nodo}/config`) {
        const config = bancal.alConfig(texto, ahora)
        if (config) fs.writeFileSync(o.estado, JSON.stringify(config))
      } else {
        const orden = new RegExp(`^${o.nodo}/actuador/([^/]+)/cmd$`).exec(topico)
        if (orden) {
          log(`Orden recibida: ${orden[1]} -> ${texto}`)
          bancal.alOrden(orden[1], texto, ahora)
        }
      }
      emitirEstado()
    })
    emitirEstado()
  }

  function desconectar() {
    if (cliente) log('Desconectado desde el panel: corte en seco, el broker avisa con el Last Will')
    soltarCliente()
    conexion.fallo = null
    pasar('desconectado')
    emitirEstado()
  }

  // ---- Sensores ----
  const minuto = () => minutoEnZona(Date.now(), bancal.configuracion().tz)
  let sensores: Sensores = estadoInicial(minuto())
  /** Los sensores fijados desde el panel: valen esto hasta que se los suelte. */
  const fijados: Partial<Sensores> = {}
  const historia: Muestra[] = []
  let ultimoAvance = Date.now()

  function avanzarModelo() {
    const ahora = Date.now()
    sensores = { ...avanzar(sensores, (ahora - ultimoAvance) / 1000, minuto(), bancal.actuadores), ...fijados }
    ultimoAvance = ahora
  }

  /** "Lee" los sensores: publica (como la placa, QoS 0 y sin retener) y aplica las reglas. */
  function leer(periodica: boolean) {
    const ahora = Date.now()
    publicar('sensor/temperatura_suelo', sensores.temperaturaSuelo.toFixed(1), false)
    publicar('sensor/temperatura_aire', sensores.temperaturaAire.toFixed(1), false)
    publicar('sensor/humedad_aire', sensores.humedadAire.toFixed(0), false)
    publicar('sensor/humedad_suelo', sensores.humedadSuelo.toFixed(0), false)
    publicar('sensor/luz', String(sensores.luz), false)
    bancal.alLeer(sensores, ahora, periodica)
    const muestra: Muestra = { t: ahora, s: sensores, a: { ...bancal.actuadores } }
    historia.push(muestra)
    while (historia.length && historia[0].t < ahora - HISTORIA_MS) historia.shift()
    emitir('muestra', muestra)
    emitirEstado()
  }

  let lecturaPedida: NodeJS.Timeout | null = null
  function fijar(sensor: Sensor, valor: number) {
    const [min, max] = LIMITES[sensor]
    const v = Math.min(max, Math.max(min, valor))
    Object.assign(fijados, { [sensor]: sensor === 'luz' ? (v >= 0.5 ? 1 : 0) : v })
    sensores = { ...sensores, ...fijados }
    // Una lectura enseguida (sin esperar los 5 s), cuando se deja de mover el control
    if (lecturaPedida) clearTimeout(lecturaPedida)
    lecturaPedida = setTimeout(() => leer(false), 250)
    emitirEstado()
  }
  function soltar(sensor: Sensor) {
    delete fijados[sensor]
    emitirEstado()
  }

  function estado() {
    const config = bancal.configuracion()
    return {
      nodo: o.nodo,
      url: o.url,
      intervaloMs: o.intervaloMs,
      ahora: Date.now(),
      minuto: minuto(),
      sensores,
      fijados: Object.keys(fijados),
      actuadores: Object.fromEntries(ACTUADORES.map((a) => [a, { prendido: bancal.actuadores[a], desde: desdeActuador[a] }])),
      config,
      modoEfectivo: bancal.modoEfectivo(),
      conexion: { ...conexion },
    }
  }
  function emitirEstado() {
    emitir('estado', estado())
  }

  const relojes: NodeJS.Timeout[] = []
  return {
    estado,
    historia: () => historia,
    logs: () => logs,
    /** Avisa de cada cambio; devuelve cómo dejar de escuchar. */
    escuchar(f: (e: Evento) => void) {
      oyentes.add(f)
      return () => void oyentes.delete(f)
    },
    fijar,
    soltar,

    /** Cambia la conexión desde el panel. Tocar el certificado o la contraseña reconecta con lo nuevo. */
    conexion(cambios: { conectar?: boolean; certificado?: boolean; clave?: boolean }) {
      if (typeof cambios.certificado === 'boolean') conexion.certificado = cambios.certificado
      if (typeof cambios.clave === 'boolean') conexion.clave = cambios.clave
      if (typeof cambios.conectar === 'boolean') conexion.deseada = cambios.conectar
      if (conexion.deseada) conectar()
      else desconectar()
    },

    arrancar() {
      log(`${o.nodo}: configuración guardada v${bancal.configuracion().v}, modo ${bancal.configuracion().modo}`)
      conectar()
      relojes.push(
        // El modelo avanza cada segundo (para verlo moverse); se "lee" y publica cada intervaloMs, como la placa
        setInterval(() => {
          avanzarModelo()
          emitirEstado()
        }, 1000),
        setInterval(() => {
          const s = sensores, a = bancal.actuadores
          log(`suelo=${s.temperaturaSuelo.toFixed(1)} C ${s.humedadSuelo.toFixed(0)} %  aire=${s.temperaturaAire.toFixed(1)} C ${s.humedadAire.toFixed(0)} %  luz=${s.luz}  [luz ${+a.luz} cooler ${+a.cooler} riego ${+a.riego}]`)
          leer(true)
        }, o.intervaloMs),
        // El pulso de riego se corta por tiempo, aunque no haya red
        setInterval(() => bancal.alPasarElTiempo(Date.now()), 200),
      )
    },

    /** Cierre prolijo (Ctrl+C): avisa "offline" y se desconecta. */
    async cerrar() {
      relojes.forEach(clearInterval)
      const c = cliente
      if (!c) return
      log('Cerrando: el bancal queda desconectado')
      c.removeAllListeners('close')
      if (c.connected) await c.publishAsync(`${o.nodo}/presencia`, 'offline', { qos: 1, retain: true }).catch(() => {})
      await c.endAsync(true)
    },
  }
}

export type Simulador = ReturnType<typeof crearSimulador>
