/**
 * Servidor HTTP del servicio:
 *
 * - `GET /api/estado`: instantánea del estado de los bancales en JSON.
 * - `GET /api/eventos`: Server-Sent Events. Al conectarse manda la instantánea completa y después una
 *   nueva en cada cambio (evento `estado`). El navegador lo lee con `new EventSource('/api/eventos')`
 *   y se reconecta solo si se corta.
 * - Todo lo demás: los archivos del build de la web (`pnpm build` en diseño_pagina_web/web).
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { Bancales } from './bancal.ts'
import type { Config } from './config.ts'

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

export function crearServidorHttp({ http: config }: Config, bancales: Bancales, log: (mensaje: string) => void) {
  const servidor = http.createServer((pedido, respuesta) => {
    const url = new URL(pedido.url ?? '/', 'http://servicio')

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

    if (url.pathname.startsWith('/api/')) {
      respuesta.writeHead(404, { 'Content-Type': TIPOS['.json'] }).end('{"error":"no existe"}')
      return
    }

    servirArchivo(config.webDist, url.pathname, respuesta)
  })

  servidor.listen(config.puerto, config.host, () => {
    log(`Web y API en http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.puerto}`)
    if (!fs.existsSync(path.join(config.webDist, 'index.html'))) {
      log(`Todavía no está el build de la web en ${config.webDist}: correr "pnpm build" en diseño_pagina_web/web`)
    }
  })

  return {
    cerrar: () =>
      new Promise<void>((listo) => {
        servidor.close(() => listo())
        servidor.closeAllConnections() // las conexiones SSE no se cierran solas
      }),
  }
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
