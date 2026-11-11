/**
 * El panel del simulador: una página (panel.html) que muestra el bancal en vivo y lo maneja.
 *
 *   GET  /              la página
 *   GET  /eventos       el estado en vivo (Server-Sent Events): al entrar manda todo, después los cambios
 *   POST /api/sensor    { sensor, valor } fija un sensor; { sensor, fijado: false } lo suelta
 *   POST /api/conexion  { conectar?, certificado?, clave? }
 *
 * Solo escucha en la propia computadora (127.0.0.1): maneja un cliente con credenciales del broker.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { LIMITES, type Sensor, type Simulador } from './simulador.ts'

const PAGINA = path.resolve(import.meta.dirname, 'panel.html')

export function servirPanel(sim: Simulador, puerto: number, host = '127.0.0.1') {
  const servidor = http.createServer(async (pedido, respuesta) => {
    const responder = (codigo: number, cuerpo: unknown) => {
      respuesta.writeHead(codigo, { 'content-type': 'application/json' })
      respuesta.end(JSON.stringify(cuerpo))
    }
    const ruta = (pedido.url ?? '/').split('?')[0]

    if (pedido.method === 'GET' && ruta === '/') {
      // Se lee en cada pedido: se puede retocar la página sin reiniciar el simulador
      respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return respuesta.end(fs.readFileSync(PAGINA))
    }

    if (pedido.method === 'GET' && ruta === '/eventos') {
      respuesta.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      const mandar = (tipo: string, datos: unknown) => respuesta.write(`event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`)
      mandar('inicio', { estado: sim.estado(), historia: sim.historia(), logs: sim.logs(), limites: LIMITES })
      const dejar = sim.escuchar((e) => mandar(e.tipo, e.datos))
      return void pedido.on('close', dejar)
    }

    if (pedido.method === 'POST' && ruta.startsWith('/api/')) {
      // Exigir JSON impide que otra página abierta en el navegador le mande órdenes al simulador
      if (!pedido.headers['content-type']?.startsWith('application/json')) return responder(415, { error: 'se espera JSON' })
      let cuerpo: Record<string, unknown>
      try {
        let texto = ''
        for await (const parte of pedido) texto += parte
        cuerpo = JSON.parse(texto)
      } catch {
        return responder(400, { error: 'no es JSON' })
      }
      if (ruta === '/api/sensor') {
        const sensor = cuerpo.sensor as Sensor
        if (!Object.hasOwn(LIMITES, sensor)) return responder(400, { error: 'sensor desconocido' })
        if (cuerpo.fijado === false) sim.soltar(sensor)
        else if (typeof cuerpo.valor === 'number' && Number.isFinite(cuerpo.valor)) sim.fijar(sensor, cuerpo.valor)
        else return responder(400, { error: 'falta el valor' })
        return responder(200, { ok: true })
      }
      if (ruta === '/api/conexion') {
        sim.conexion(cuerpo)
        return responder(200, { ok: true })
      }
    }
    responder(404, { error: 'no existe' })
  })
  servidor.listen(puerto, host)
  return servidor
}
