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

const config = { http: { puerto: 0, host: '127.0.0.1', webDist: '/no-existe' } } as Config
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
