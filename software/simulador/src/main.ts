/**
 * ESP32 simulado: un bancal más, que corre en una computadora y se conecta al broker igual que la placa
 * (MQTT con TLS mutuo, mismo esquema de tópicos, mismas reglas). Sirve para tener dos bancales sin otra
 * placa y para probar sin tocar los relés ni la bomba de verdad. Se maneja desde un panel web.
 *
 *   cp .env.example .env    (y completar MQTT_PASSWORD)
 *   pnpm start              (y abrir http://localhost:8091)
 */
import path from 'node:path'
import { servirPanel } from './panel.ts'
import { crearSimulador } from './simulador.ts'

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
const PUERTO = Number(variable('PANEL_PUERTO', '8091'))

const simulador = crearSimulador({
  nodo: NODO,
  url: variable('MQTT_URL', 'mqtts://bancal.taile538b8.ts.net:443'),
  password: variable('MQTT_PASSWORD'),
  ca: archivo('MQTT_CA', '../broker/security/certs/ca.pem'),
  cert: archivo('MQTT_CERT', `../broker/security/certs/clientes/${NODO}.pem`),
  key: archivo('MQTT_KEY', `../broker/security/certs/clientes/${NODO}.key`),
  estado: archivo('ESTADO', './estado.json'),
  intervaloMs: Number(variable('INTERVALO_MS', '5000')),
})

const panel = servirPanel(simulador, PUERTO)
panel.on('error', (e) => console.error(`El panel no pudo abrir el puerto ${PUERTO}: ${e.message} (cambiar PANEL_PUERTO en .env)`))
panel.on('listening', () => console.log(`Panel del simulador: http://localhost:${PUERTO}`))
simulador.arrancar()

async function cerrar() {
  await simulador.cerrar()
  process.exit(0)
}
process.once('SIGINT', cerrar)
process.once('SIGTERM', cerrar)
