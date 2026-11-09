/**
 * Servicio central del sistema de bancales.
 *
 * 1. Se conecta al broker por TLS con el usuario `servicio` (mqtt.ts).
 * 2. Con cada lectura aplica las reglas (reglas.ts) y, si cambia la decisión, publica la orden en
 *    `{nodoId}/actuador/{tipo}/cmd` (bancal.ts).
 * 3. Sirve la web y le pasa el estado por Server-Sent Events (http.ts).
 * 4. Le pasa a la web el historial de lecturas que EMQX guarda en MySQL (historial.ts).
 *
 * Se corre con `pnpm start` (o `pnpm dev`, que se reinicia al cambiar el código) desde software/servicio.
 */
import { crearBancales } from './bancal.ts'
import { leerConfig } from './config.ts'
import { conectarHistorial } from './historial.ts'
import { crearServidorHttp } from './http.ts'
import { conectarBroker } from './mqtt.ts'

const log = (mensaje: string) => console.log(`[${new Date().toLocaleTimeString('es-AR', { hour12: false })}] ${mensaje}`)

let config
try {
  config = leerConfig()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const u = config.umbrales
log(
  `Reglas: luz prende a oscuras; riego prende con humedad_suelo < ${u.riegoEncenderDebajoDe} % y apaga con >= ${u.riegoApagarDesde} %; ` +
    `ventilador prende con temperatura_aire >= ${u.ventiladorEncenderDesde} °C y apaga con < ${u.ventiladorApagarDebajoDe} °C`,
)

// `broker` se asigna enseguida; las órdenes solo se publican al llegar mensajes, que es después de conectar.
let broker: ReturnType<typeof conectarBroker>
const bancales = crearBancales({
  umbrales: config.umbrales,
  publicar: (nodoId, actuador, encendido) => broker.publicarOrden(nodoId, actuador, encendido),
  log,
})
broker = conectarBroker(config, {
  alMensaje: bancales.alMensaje,
  alConectar: bancales.setBroker,
  log,
})
const historial = config.historial ? conectarHistorial(config.historial) : null
log(
  config.historial
    ? `Historial: MySQL en ${config.historial.host}:${config.historial.puerto} como "${config.historial.usuario}"`
    : 'Historial: sin MySQL (falta MYSQL_HOST o MYSQL_LECTOR_PASSWORD), /api/historial responde 503',
)
const servidor = crearServidorHttp(config, bancales, log, historial?.consultar ?? null)

async function cerrar() {
  log('Cerrando...')
  await Promise.allSettled([broker.cerrar(), servidor.cerrar(), historial?.cerrar()])
  process.exit(0)
}
process.once('SIGINT', cerrar)
process.once('SIGTERM', cerrar)
