/**
 * ESP32 simulado: un bancal más, que corre en una computadora y se conecta al broker igual que la placa
 * (MQTT con TLS mutuo, mismo esquema de tópicos, mismas reglas). Sirve para tener dos bancales sin otra
 * placa y para probar sin tocar los relés ni la bomba de verdad.
 *
 *   cp .env.example .env    (y completar MQTT_PASSWORD)
 *   pnpm start
 */
import fs from 'node:fs'
import path from 'node:path'
import mqtt from 'mqtt'
import { CONFIG_POR_DEFECTO, crearBancal, minutoEnZona, type Configuracion } from './bancal.ts'
import { avanzar, estadoInicial, type Sensores } from './modelo.ts'

const CARPETA = path.resolve(import.meta.dirname, '..')
const variable = (nombre: string, porDefecto?: string) => {
  const valor = process.env[nombre]?.trim() || porDefecto
  if (valor === undefined) {
    console.error(`Falta ${nombre} en software/simulador/.env (ver .env.example)`)
    process.exit(1)
  }
  return valor
}
const archivo = (nombre: string, porDefecto: string) => path.resolve(CARPETA, variable(nombre, porDefecto))

const NODO = variable('NODO_ID', 'bancal2esp1')
const URL = variable('MQTT_URL', 'mqtts://bancal.taile538b8.ts.net:443')
const ESTADO = archivo('ESTADO', './estado.json')
const INTERVALO_MS = Number(variable('INTERVALO_MS', '5000'))

const log = (mensaje: string) => console.log(`[${new Date().toLocaleTimeString('es-AR', { hour12: false })}] ${mensaje}`)

// La "NVS": la última configuración recibida, para arrancar con ella aunque no haya broker
function configGuardada(): Configuracion {
  try {
    return JSON.parse(fs.readFileSync(ESTADO, 'utf8')) as Configuracion
  } catch {
    return CONFIG_POR_DEFECTO
  }
}

const cliente = mqtt.connect(URL, {
  // Como la placa: el client ID es el usuario (EMQX lo exige) y el usuario es el CN del certificado
  clientId: NODO,
  username: NODO,
  password: variable('MQTT_PASSWORD'),
  ca: fs.readFileSync(archivo('MQTT_CA', '../broker/security/certs/ca.pem')),
  cert: fs.readFileSync(archivo('MQTT_CERT', `../broker/security/certs/clientes/${NODO}.pem`)),
  key: fs.readFileSync(archivo('MQTT_KEY', `../broker/security/certs/clientes/${NODO}.key`)),
  rejectUnauthorized: true,
  clean: true,
  keepalive: 10,
  reconnectPeriod: 5000,
  will: { topic: `${NODO}/presencia`, payload: Buffer.from('offline'), qos: 1, retain: true },
})

const bancal = crearBancal(
  {
    estado: (a, prendido) => cliente.connected && cliente.publish(`${NODO}/actuador/${a}/estado`, prendido ? '1' : '0', { qos: 1, retain: true }),
    aplicada: (json) => cliente.connected && cliente.publish(`${NODO}/config/aplicada`, json, { qos: 1, retain: true }),
    log,
  },
  configGuardada(),
)
log(`${NODO}: configuración guardada v${bancal.configuracion().v}, modo ${bancal.configuracion().modo}`)

cliente.on('connect', () => {
  log(`Conectado a ${URL} como "${NODO}"`)
  cliente.publish(`${NODO}/presencia`, 'online', { qos: 1, retain: true })
  cliente.subscribe([`${NODO}/actuador/+/cmd`, `${NODO}/config`, 'servicio/conexion'], { qos: 1 })
  bancal.alConectar()
})
cliente.on('close', () => bancal.alServicio(false, Date.now()))
cliente.on('error', (e) => log(`Error MQTT: ${e.message}`))
cliente.on('message', (topico, mensaje) => {
  const texto = mensaje.toString('utf8')
  const ahora = Date.now()
  if (topico === 'servicio/conexion') return bancal.alServicio(texto === 'online', ahora)
  if (topico === `${NODO}/config`) {
    const config = bancal.alConfig(texto, ahora)
    if (config) fs.writeFileSync(ESTADO, JSON.stringify(config))
    return
  }
  const orden = new RegExp(`^${NODO}/actuador/([^/]+)/cmd$`).exec(topico)
  if (orden) {
    log(`Orden recibida: ${orden[1]} -> ${texto}`)
    bancal.alOrden(orden[1], texto, ahora)
  }
})

// Cada INTERVALO_MS: avanza la simulación, "lee" y publica (como la placa, QoS 0 y sin retener)
let sensores: Sensores = estadoInicial(minutoEnZona(Date.now(), bancal.configuracion().tz))
let ultimo = Date.now()
setInterval(() => {
  const ahora = Date.now()
  sensores = avanzar(sensores, (ahora - ultimo) / 1000, minutoEnZona(ahora, bancal.configuracion().tz), bancal.actuadores)
  ultimo = ahora
  const a = bancal.actuadores
  log(`suelo=${sensores.temperaturaSuelo.toFixed(1)} C ${sensores.humedadSuelo.toFixed(0)} %  aire=${sensores.temperaturaAire.toFixed(1)} C ${sensores.humedadAire.toFixed(0)} %  luz=${sensores.luz}  [luz ${+a.luz} cooler ${+a.cooler} riego ${+a.riego}]`)
  if (cliente.connected) {
    const publicar = (tipo: string, valor: string) => cliente.publish(`${NODO}/sensor/${tipo}`, valor, { qos: 0 })
    publicar('temperatura_suelo', sensores.temperaturaSuelo.toFixed(1))
    publicar('temperatura_aire', sensores.temperaturaAire.toFixed(1))
    publicar('humedad_aire', sensores.humedadAire.toFixed(0))
    publicar('humedad_suelo', sensores.humedadSuelo.toFixed(0))
    publicar('luz', String(sensores.luz))
  }
  bancal.alLeer(sensores, ahora)
}, INTERVALO_MS)

// El pulso de riego se corta por tiempo, aunque no haya red
setInterval(() => bancal.alPasarElTiempo(Date.now()), 200)

async function cerrar() {
  log('Cerrando: el bancal queda desconectado')
  await cliente.publishAsync(`${NODO}/presencia`, 'offline', { qos: 1, retain: true }).catch(() => {})
  await cliente.endAsync()
  process.exit(0)
}
process.once('SIGINT', cerrar)
process.once('SIGTERM', cerrar)
