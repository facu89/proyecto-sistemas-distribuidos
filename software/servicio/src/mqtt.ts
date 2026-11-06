/**
 * Conexión del servicio con el broker: MQTT sobre TLS, con el usuario `servicio`.
 *
 * Lo que puede hacer lo limita la ACL de software/broker (02-init-users.sh): leer `+/sensor/+`,
 * `+/actuador/+/estado` y `+/presencia`, y publicar en `+/actuador/+/cmd`.
 */
import fs from 'node:fs'
import mqtt from 'mqtt'
import type { Config } from './config.ts'
import type { Actuador } from './reglas.ts'

/** Ver la tabla de software/broker/topics.md. */
const SUSCRIPCIONES = { '+/sensor/+': { qos: 0 }, '+/actuador/+/estado': { qos: 1 }, '+/presencia': { qos: 1 } } as const
const QOS_ORDENES = 1
const RECONEXION_MS = 5000

type Eventos = {
  alMensaje: (topico: string, texto: string) => void
  alConectar: (conectado: boolean) => void
  log: (mensaje: string) => void
}

export function conectarBroker({ mqtt: config }: Config, { alMensaje, alConectar, log }: Eventos) {
  const cliente = mqtt.connect(config.url, {
    username: config.usuario,
    password: config.clave,
    // Un solo cliente "servicio": si se lanza una segunda copia, el broker desconecta a la primera
    // en vez de tener dos servicios mandando órdenes a la vez.
    clientId: config.usuario,
    clean: true,
    // TLS: solo se acepta un broker cuyo certificado haya firmado nuestra CA y que incluya el nombre de MQTT_URL.
    ca: fs.readFileSync(config.ca),
    rejectUnauthorized: true,
    reconnectPeriod: RECONEXION_MS,
    connectTimeout: 10_000,
  })

  cliente.on('connect', () => {
    log(`Conectado al broker ${config.url} como "${config.usuario}"`)
    // clean: true -> las suscripciones no sobreviven a una desconexión: se repiten en cada conexión.
    cliente.subscribe(SUSCRIPCIONES, (error, otorgadas) => {
      if (error) return log(`Error al suscribirse: ${error.message}`)
      // 128 = el broker la rechazó (la ACL no lo permite)
      for (const { topic, qos } of otorgadas ?? []) {
        if (qos === 128) log(`El broker rechazó la suscripción a ${topic}: revisar la ACL del usuario ${config.usuario}`)
      }
    })
    alConectar(true)
  })
  cliente.on('close', () => alConectar(false))
  cliente.on('reconnect', () => log(`Reintentando la conexión con ${config.url}...`))
  // Clave equivocada, certificado que no valida, broker apagado...: mqtt.js reintenta solo.
  cliente.on('error', (error) => log(`Error MQTT: ${error.message}`))
  cliente.on('message', (topico, mensaje) => alMensaje(topico, mensaje.toString('utf8')))

  return {
    /** Publica `on`/`off` en `{nodoId}/actuador/{tipo}/cmd`. Sin conexión, mqtt.js la encola hasta reconectar. */
    async publicarOrden(nodoId: string, actuador: Actuador, encendido: boolean) {
      // Sin retain: si quedara retenida, el ESP32 la volvería a ejecutar cada vez que se conecta.
      await cliente.publishAsync(`${nodoId}/actuador/${actuador}/cmd`, encendido ? 'on' : 'off', {
        qos: QOS_ORDENES,
        retain: false,
      })
    },
    cerrar: () => cliente.endAsync(),
  }
}
