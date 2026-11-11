import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { crearBancales, type Instantanea } from './bancal.ts'
import type { Config } from './config.ts'
import { crearServidorHttp } from './http.ts'

const UMBRALES = { riegoEncenderDebajoDe: 20, riegoApagarDesde: 70, ventiladorEncenderDesde: 28, ventiladorApagarDebajoDe: 26 }
const publicadas: string[] = []
const bancales = crearBancales({
  umbrales: UMBRALES,
  publicar: async (n, a, e) => void publicadas.push(`${n}/${a}=${e ? 1 : 0}`),
})
bancales.alMensaje('bancal1esp1/presencia', 'online')

const TOKEN = 'secreto-de-prueba'
const config = { http: { puerto: 0, host: '127.0.0.1', webDist: '/no-existe' }, webhook: { token: TOKEN } } as Config
let servidor: ReturnType<typeof crearServidorHttp>
let base: string

before(async () => {
  servidor = crearServidorHttp(config, bancales, () => {})
  base = `http://127.0.0.1:${await servidor.puerto()}`
})
after(() => servidor.cerrar())

const post = (ruta: string, cuerpo: unknown, encabezados: Record<string, string> = {}) =>
  fetch(base + ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...encabezados },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  })

describe('POST /api', () => {
  it('cambia el modo y ordena en manual', async () => {
    assert.equal((await post('/api/nodos/bancal1esp1/modo', { modo: 'manual' })).status, 204)
    assert.equal(bancales.instantanea().nodos.bancal1esp1.modo, 'manual')
    assert.equal((await post('/api/nodos/bancal1esp1/actuadores/riego', { encendido: true })).status, 204)
    assert.deepEqual(publicadas, ['bancal1esp1/riego=1'])
  })

  it('en automático rechaza las órdenes manuales con 409', async () => {
    await post('/api/nodos/bancal1esp1/modo', { modo: 'automatico' })
    const r = await post('/api/nodos/bancal1esp1/actuadores/luz', { encendido: true })
    assert.equal(r.status, 409)
    assert.match(((await r.json()) as { error: string }).error, /automático/)
  })

  it('valida lo que recibe', async () => {
    assert.equal((await post('/api/nodos/bancal1esp1/modo', { modo: 'turbo' })).status, 400)
    assert.equal((await post('/api/nodos/bancal1esp1/actuadores/luz', { encendido: 'si' })).status, 400)
    assert.equal((await post('/api/nodos/bancal1esp1/actuadores/bomba', { encendido: true })).status, 404)
    assert.equal((await post('/api/nodos/otro/modo', { modo: 'manual' })).status, 404)
    assert.equal((await post('/api/nodos/bancal1esp1/modo', '{no es json')).status, 400)
    assert.equal((await post('/api/otra/cosa', {})).status, 404)
  })

  it('rechaza pedidos de otro origen y sin JSON (los que una página ajena podría mandar)', async () => {
    assert.equal((await post('/api/nodos/bancal1esp1/modo', { modo: 'manual' }, { Origin: 'http://malo.example' })).status, 403)
    const sinJson = await fetch(`${base}/api/nodos/bancal1esp1/modo`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"modo":"manual"}',
    })
    assert.equal(sinJson.status, 415)
    assert.equal(bancales.instantanea().nodos.bancal1esp1.modo, 'automatico')
  })

  it('acepta el mismo origen', async () => {
    const origen = new URL(base).origin
    assert.equal((await post('/api/nodos/bancal1esp1/modo', { modo: 'manual' }, { Origin: origen })).status, 204)
  })

  it('el estado incluye el modo', async () => {
    const estado = (await (await fetch(`${base}/api/estado`)).json()) as Instantanea
    assert.equal(estado.nodos.bancal1esp1.modo, 'manual')
  })
})

describe('POST /api/webhooks/conexiones', () => {
  const evento = { event: 'client.disconnected', clientid: 'bancal1esp1', username: 'bancal1esp1', reason: 'keepalive_timeout', timestamp: 1700000000000 }
  const conToken = { Authorization: `Bearer ${TOKEN}` }

  it('rechaza sin token o con uno equivocado', async () => {
    assert.equal((await post('/api/webhooks/conexiones', evento)).status, 401)
    assert.equal((await post('/api/webhooks/conexiones', evento, { Authorization: 'Bearer otro' })).status, 401)
  })

  it('rechaza lo que no es un evento de conexión', async () => {
    assert.equal((await post('/api/webhooks/conexiones', { event: 'message.publish', clientid: 'x' }, conToken)).status, 400)
    assert.equal((await post('/api/webhooks/conexiones', '{no es json', conToken)).status, 400)
  })

  it('reenvía el aviso a la web por SSE (evento conexion)', async () => {
    const controlador = new AbortController()
    const sse = await fetch(`${base}/api/eventos`, { signal: controlador.signal })
    const lector = sse.body!.pipeThrough(new TextDecoderStream()).getReader()
    // Esperar la instantánea inicial: recién ahí el servidor tiene anotada esta conexión SSE.
    let recibido = ''
    while (!recibido.includes('event: estado')) recibido += (await lector.read()).value

    assert.equal((await post('/api/webhooks/conexiones', evento, conToken)).status, 204)
    while (!recibido.includes('event: conexion')) recibido += (await lector.read()).value
    controlador.abort()

    const datos = /event: conexion\ndata: (.*)\n/.exec(recibido)![1]
    assert.deepEqual(JSON.parse(datos), {
      tipo: 'desconectado',
      clientid: 'bancal1esp1',
      usuario: 'bancal1esp1',
      motivo: 'dejó de responder',
      instante: 1700000000000,
    })
  })
})
