import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { crearBancales, type Instantanea } from './bancal.ts'
import type { Config } from './config.ts'
import type { PedidoHistorial } from './historial.ts'
import { crearServidorHttp } from './http.ts'

const UMBRALES = { riegoEncenderDebajoDe: 20, riegoApagarDesde: 70, ventiladorEncenderDesde: 28, ventiladorApagarDebajoDe: 26, luzHorario: null, riegoPulsoSegundos: 5, riegoEsperaLecturas: 2 }
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

describe('GET /api/historial', () => {
  it('sin MySQL responde 503', async () => {
    const respuesta = await fetch(`${base}/api/historial?nodo=bancal1esp1`)
    assert.equal(respuesta.status, 503)
  })

  it('devuelve lo que consulta y valida los parámetros antes', async () => {
    const pedidos: PedidoHistorial[] = []
    const conHistorial = crearServidorHttp(config, bancales, () => {}, async (pedido) => {
      pedidos.push(pedido)
      return { nodo: pedido.nodo, desde: pedido.desde, hasta: pedido.hasta, series: { luz: [[pedido.desde, 1]] } }
    })
    const url = `http://127.0.0.1:${await conHistorial.puerto()}/api/historial`
    try {
      const respuesta = await fetch(`${url}?nodo=bancal1esp1&desde=1000&hasta=5000&tipo=luz`)
      assert.equal(respuesta.status, 200)
      assert.deepEqual(await respuesta.json(), { nodo: 'bancal1esp1', desde: 1000, hasta: 5000, series: { luz: [[1000, 1]] } })

      assert.equal((await fetch(`${url}?nodo=bancal1esp1&desde=9&hasta=1`)).status, 400)
      assert.equal(pedidos.length, 1) // el pedido inválido no llega a MySQL
    } finally {
      await conHistorial.cerrar()
    }
  })

  it('si MySQL falla responde 503 sin mostrar el error interno', async () => {
    const conHistorial = crearServidorHttp(config, bancales, () => {}, async () => {
      throw new Error('Access denied for user lector')
    })
    try {
      const respuesta = await fetch(`http://127.0.0.1:${await conHistorial.puerto()}/api/historial?nodo=x`)
      assert.equal(respuesta.status, 503)
      assert.doesNotMatch(((await respuesta.json()) as { error: string }).error, /lector/)
    } finally {
      await conHistorial.cerrar()
    }
  })
})

describe('POST /api/nodos/{nodo}/umbrales', () => {
  const rangos = { ...UMBRALES, riegoEncenderDebajoDe: 30, riegoApagarDesde: 60, luzHorario: { desde: '18:00', hasta: '23:00' } }

  it('cambia los rangos del bancal y con null vuelve a los de por defecto', async () => {
    assert.equal((await post('/api/nodos/bancal1esp1/umbrales', { umbrales: rangos })).status, 204)
    const nodo = bancales.instantanea().nodos.bancal1esp1
    assert.deepEqual(nodo.umbrales, rangos)
    assert.equal((await post('/api/nodos/bancal1esp1/umbrales', { umbrales: null })).status, 204)
    assert.equal(bancales.instantanea().nodos.bancal1esp1.umbralesPropios, false)
  })

  it('valida forma y valores', async () => {
    const malo = async (cuerpo: unknown) => (await post('/api/nodos/bancal1esp1/umbrales', cuerpo)).status
    assert.equal(await malo({}), 400)
    assert.equal(await malo({ umbrales: { ...rangos, riegoApagarDesde: '60' } }), 400)
    assert.equal(await malo({ umbrales: { ...rangos, luzHorario: { desde: 18 } } }), 400)
    const respuesta = await post('/api/nodos/bancal1esp1/umbrales', { umbrales: { ...rangos, ventiladorApagarDebajoDe: 27.5 } })
    assert.equal(respuesta.status, 400)
    assert.match(((await respuesta.json()) as { error: string }).error, /2 °C/)
  })

  it('nodo desconocido: 404; otro origen: 403', async () => {
    assert.equal((await post('/api/nodos/no-existe/umbrales', { umbrales: null })).status, 404)
    assert.equal((await post('/api/nodos/bancal1esp1/umbrales', { umbrales: null }, { Origin: 'http://otra.com' })).status, 403)
  })
})
