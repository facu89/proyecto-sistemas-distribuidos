/**
 * Servicio central del sistema de bancales.
 *
 * 1. Se conecta al broker por TLS con el usuario `servicio` (mqtt.ts).
 * 2. Con cada lectura aplica las reglas (reglas.ts) y, si cambia la decisión, publica la orden en
 *    `{nodoId}/actuador/{tipo}/cmd` (bancal.ts).
 * 3. Sirve la web y le pasa el estado por Server-Sent Events (http.ts).
 * 4. Le pasa a la web el historial de lecturas que EMQX guarda en MySQL (historial.ts).
 * 5. Guarda en MySQL el modo y los rangos de cada bancal y los carga al arrancar (configuracion.ts).
 *
 * Se corre con `pnpm start` (o `pnpm dev`, que se reinicia al cambiar el código) desde software/servicio.
 */
import { setTimeout as esperar } from 'node:timers/promises'
import { crearBancales } from './bancal.ts'
import { leerConfig } from './config.ts'
import { crearAlmacen, type Almacen } from './configuracion.ts'
import { crearHistorial } from './historial.ts'
import { crearServidorHttp } from './http.ts'
import { conectarBroker } from './mqtt.ts'
import { conectarMysql } from './mysql.ts'

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
  `Reglas por defecto: luz prende a oscuras${u.luzHorario ? ` entre ${u.luzHorario.desde} y ${u.luzHorario.hasta}` : ''}; ` +
    `riego prende con humedad_suelo < ${u.riegoEncenderDebajoDe} % y apaga con >= ${u.riegoApagarDesde} %; ` +
    `ventilador prende con temperatura_aire >= ${u.ventiladorEncenderDesde} °C y apaga con < ${u.ventiladorApagarDebajoDe} °C`,
)

const pool = config.mysql ? conectarMysql(config.mysql) : null
log(
  config.mysql
    ? `MySQL en ${config.mysql.host}:${config.mysql.puerto} como "${config.mysql.usuario}" (historial, modo y rangos de cada bancal)`
    : 'Sin MySQL (falta MYSQL_HOST o MYSQL_SERVICIO_PASSWORD): /api/historial responde 503 y el modo y los rangos no se guardan',
)
const almacen = pool ? crearAlmacen(pool, log) : null

// `broker` se asigna enseguida; las órdenes solo se publican al llegar mensajes, que es después de conectar.
let broker: ReturnType<typeof conectarBroker>
const bancales = crearBancales({
  umbrales: config.umbrales,
  publicar: (nodoId, actuador, encendido) => broker.publicarOrden(nodoId, actuador, encendido),
  almacen,
  zonaHoraria: config.zonaHoraria,
  log,
})

/**
 * Carga el modo y los rangos guardados. Se intenta antes de conectarse al broker, así las primeras
 * lecturas ya se evalúan con los rangos de cada bancal. Si MySQL todavía no responde (recién arranca),
 * se reintenta: hasta medio minuto antes de seguir con los valores por defecto, y después cada 30 s en
 * segundo plano hasta que cargue.
 */
async function cargarGuardado(almacen: Almacen, intentos: number, pausa: number): Promise<boolean> {
  for (let i = 1; i <= intentos; i++) {
    try {
      const guardado = await almacen.cargar()
      bancales.cargarConfiguracion(guardado)
      log(`Configuración guardada: ${Object.keys(guardado).length} bancal(es)`)
      return true
    } catch (error) {
      if (i === intentos) log(`No se pudo leer la configuración guardada: ${error instanceof Error ? error.message : error}`)
      await esperar(pausa)
    }
  }
  return false
}

if (almacen && !(await cargarGuardado(almacen, 10, 3000))) {
  log('Se sigue con los valores por defecto; se reintenta cada 30 s')
  void (async () => {
    while (!(await cargarGuardado(almacen, 1, 30_000)));
  })()
}

broker = conectarBroker(config, {
  alMensaje: bancales.alMensaje,
  alConectar: bancales.setBroker,
  log,
})
const servidor = crearServidorHttp(config, bancales, log, pool ? crearHistorial(pool) : null)

async function cerrar() {
  log('Cerrando...')
  await Promise.allSettled([broker.cerrar(), servidor.cerrar(), pool?.end()])
  process.exit(0)
}
process.once('SIGINT', cerrar)
process.once('SIGTERM', cerrar)
