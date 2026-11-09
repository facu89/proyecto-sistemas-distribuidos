/**
 * Servidor HTTP del servicio:
 *
 * - `GET /api/estado`: instantánea del estado de los bancales en JSON.
 * - `GET /api/eventos`: Server-Sent Events. Al conectarse manda la instantánea completa y después una
 *   nueva en cada cambio (evento `estado`). El navegador lo lee con `new EventSource('/api/eventos')`
 *   y se reconecta solo si se corta.
 * - `GET /api/historial?nodo=&desde=&hasta=&tipo=`: lecturas guardadas en MySQL (historial.ts). `desde` y
 *   `hasta` en ms desde 1970 (por defecto, las últimas 24 h); `tipo` opcional (un solo sensor).
 *   503 si el servicio no tiene acceso a MySQL.
 * - `POST /api/nodos/{nodoId}/modo` con `{"modo": "automatico" | "manual"}`.
 * - `POST /api/nodos/{nodoId}/actuadores/{tipo}` con `{"encendido": true | false}` (solo en manual).
 * - Todo lo demás: los archivos del build de la web (`pnpm build` en diseño_pagina_web/web).
 *
 * Los POST manejan actuadores reales, así que solo se aceptan con `Content-Type: application/json` y
 * desde el mismo origen. Con eso, otra página abierta en el navegador no puede mandar órdenes: el
 * navegador no deja enviar JSON a otro origen sin permiso (CORS) y este servidor no lo da.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { esActuador, esModo, type Bancales, type Resultado } from './bancal.ts'
import type { Config } from './config.ts'
import { leerPedido, type ConsultarHistorial } from './historial.ts'

const MAX_CUERPO = 1024

/** Un comentario SSE cada tanto mantiene viva la conexión a través de proxies que cortan las que están quietas. */
const LATIDO_MS = 15_000

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

export function crearServidorHttp(
  { http: config }: Pick<Config, 'http'>,
  bancales: Bancales,
  log: (mensaje: string) => void,
  /** `null` si no hay MySQL: `/api/historial` responde 503. */
  consultarHistorial: ConsultarHistorial | null = null,
) {
  const servidor = http.createServer((pedido, respuesta) => {
    const url = new URL(pedido.url ?? '/', 'http://servicio')

    if (pedido.method === 'POST' && url.pathname.startsWith('/api/')) {
      atenderPost(pedido, respuesta, url.pathname, bancales, log)
      return
    }

    if (pedido.method !== 'GET' && pedido.method !== 'HEAD') {
      respuesta.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }

    if (url.pathname === '/api/estado') {
      respuesta.writeHead(200, { 'Content-Type': TIPOS['.json'], 'Cache-Control': 'no-store' })
      respuesta.end(JSON.stringify(bancales.instantanea()))
      return
    }

    if (url.pathname === '/api/eventos') {
      respuesta.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const enviar = (datos: unknown) => respuesta.write(`event: estado\ndata: ${JSON.stringify(datos)}\n\n`)
      // Si se corta, el navegador espera esto antes de reconectarse (ms).
      respuesta.write('retry: 3000\n\n')
      enviar(bancales.instantanea())
      const dejarDeEscuchar = bancales.alCambiar(enviar)
      const latido = setInterval(() => respuesta.write(': latido\n\n'), LATIDO_MS)
      pedido.on('close', () => {
        clearInterval(latido)
        dejarDeEscuchar()
      })
      return
    }

    if (url.pathname === '/api/historial') {
      atenderHistorial(url.searchParams, respuesta, consultarHistorial, log)
      return
    }

    if (url.pathname.startsWith('/api/')) {
      respuesta.writeHead(404, { 'Content-Type': TIPOS['.json'] }).end('{"error":"no existe"}')
      return
    }

    servirArchivo(config.webDist, url.pathname, respuesta)
  })

  const escuchando = new Promise<number>((listo) => servidor.once('listening', () => {
    const direccion = servidor.address()
    listo(typeof direccion === 'object' && direccion ? direccion.port : config.puerto)
  }))

  servidor.listen(config.puerto, config.host, () => {
    log(`Web y API en http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.puerto}`)
    if (!fs.existsSync(path.join(config.webDist, 'index.html'))) {
      log(`Todavía no está el build de la web en ${config.webDist}: correr "pnpm build" en diseño_pagina_web/web`)
    }
  })

  return {
    /** El puerto en que quedó escuchando (útil con puerto 0 en las pruebas). */
    puerto: () => escuchando,
    cerrar: () =>
      new Promise<void>((listo) => {
        servidor.close(() => listo())
        servidor.closeAllConnections() // las conexiones SSE no se cierran solas
      }),
  }
}

function atenderHistorial(
  parametros: URLSearchParams,
  respuesta: http.ServerResponse,
  consultar: ConsultarHistorial | null,
  log: (mensaje: string) => void,
) {
  const json = (codigo: number, cuerpo: unknown) =>
    respuesta.writeHead(codigo, { 'Content-Type': TIPOS['.json'], 'Cache-Control': 'no-store' }).end(JSON.stringify(cuerpo))

  if (!consultar) return json(503, { error: 'El historial no está disponible: el servicio no tiene acceso a MySQL' })
  const leido = leerPedido(parametros, Date.now())
  if (!leido.ok) return json(400, { error: leido.error })

  consultar(leido.pedido)
    .then((historial) => json(200, historial))
    .catch((error: unknown) => {
      log(`No se pudo leer el historial: ${error instanceof Error ? error.message : error}`)
      json(503, { error: 'No se pudo leer el historial de MySQL' })
    })
}

const RUTA_MODO = /^\/api\/nodos\/([^/]+)\/modo$/
const RUTA_ACTUADOR = /^\/api\/nodos\/([^/]+)\/actuadores\/([^/]+)$/

function atenderPost(
  pedido: http.IncomingMessage,
  respuesta: http.ServerResponse,
  ruta: string,
  bancales: Bancales,
  log: (mensaje: string) => void,
) {
  const responder = (codigo: number, error?: string) => {
    if (!error) return void respuesta.writeHead(codigo).end()
    respuesta.writeHead(codigo, { 'Content-Type': TIPOS['.json'] }).end(JSON.stringify({ error }))
  }

  const modo = RUTA_MODO.exec(ruta)
  const actuador = RUTA_ACTUADOR.exec(ruta)
  if (!modo && !actuador) return responder(404, 'No existe')

  if (!mismoOrigen(pedido)) {
    log(`POST ${ruta} rechazado: viene de otro origen (${pedido.headers.origin})`)
    return responder(403, 'Solo se aceptan pedidos desde la misma página')
  }
  if (!pedido.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    return responder(415, 'El cuerpo tiene que ser JSON (Content-Type: application/json)')
  }

  leerJson(pedido)
    .then((cuerpo) => {
      let resultado: Resultado
      if (modo) {
        const valor = (cuerpo as { modo?: unknown } | null)?.modo
        if (!esModo(valor)) return responder(400, 'Se espera {"modo": "automatico" | "manual"}')
        resultado = bancales.setModo(decodeURIComponent(modo[1]), valor)
      } else {
        const tipo = decodeURIComponent(actuador![2])
        if (!esActuador(tipo)) return responder(404, `No existe el actuador ${tipo}`)
        const valor = (cuerpo as { encendido?: unknown } | null)?.encendido
        if (typeof valor !== 'boolean') return responder(400, 'Se espera {"encendido": true | false}')
        resultado = bancales.ordenarManual(decodeURIComponent(actuador![1]), tipo, valor)
      }
      if (resultado.ok) responder(204)
      else responder(resultado.codigo, resultado.error)
    })
    .catch((error: Error) => responder(400, error.message))
}

/**
 * El navegador manda `Origin` en los POST. Tiene que ser la misma máquina y puerto que `Host` (la página
 * del servicio, o la de Vite, que reenvía sin cambiar `Host`). Sin `Origin` (curl) se acepta.
 */
function mismoOrigen(pedido: http.IncomingMessage): boolean {
  const origen = pedido.headers.origin
  if (!origen) return true
  try {
    return new URL(origen).host === pedido.headers.host
  } catch {
    return false
  }
}

function leerJson(pedido: http.IncomingMessage): Promise<unknown> {
  return new Promise((listo, fallo) => {
    const partes: Buffer[] = []
    let largo = 0
    pedido.on('data', (parte: Buffer) => {
      largo += parte.length
      if (largo > MAX_CUERPO) {
        fallo(new Error('Cuerpo demasiado grande'))
        pedido.destroy()
      } else partes.push(parte)
    })
    pedido.on('end', () => {
      try {
        listo(JSON.parse(Buffer.concat(partes).toString('utf8')))
      } catch {
        fallo(new Error('JSON inválido'))
      }
    })
    pedido.on('error', fallo)
  })
}

function servirArchivo(raiz: string, rutaPedida: string, respuesta: http.ServerResponse) {
  let relativa: string
  try {
    relativa = decodeURIComponent(rutaPedida)
  } catch {
    respuesta.writeHead(400).end()
    return
  }
  // path.join normaliza los "..": si el resultado queda fuera de la carpeta del build, se rechaza.
  let archivo = path.join(raiz, relativa)
  if (archivo !== raiz && !archivo.startsWith(raiz + path.sep)) {
    respuesta.writeHead(403).end()
    return
  }
  if (!esArchivo(archivo)) archivo = path.join(raiz, relativa, 'index.html')
  if (!esArchivo(archivo)) {
    // Una ruta sin extensión es una página de la web: se responde con index.html.
    archivo = path.extname(relativa) === '' ? path.join(raiz, 'index.html') : ''
  }
  if (!archivo || !esArchivo(archivo)) {
    respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    respuesta.end(
      esArchivo(path.join(raiz, 'index.html'))
        ? 'No existe'
        : 'Falta el build de la web: correr "pnpm build" en diseño_pagina_web/web',
    )
    return
  }

  respuesta.writeHead(200, {
    'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] ?? 'application/octet-stream',
    // Vite pone un hash en el nombre de lo que está en assets/: se puede guardar para siempre.
    'Cache-Control': archivo.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(archivo).pipe(respuesta)
}

function esArchivo(ruta: string): boolean {
  try {
    return fs.statSync(ruta).isFile()
  } catch {
    return false
  }
}
