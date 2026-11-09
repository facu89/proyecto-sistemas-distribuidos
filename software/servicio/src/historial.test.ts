import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { leerPedido, RANGO_MAXIMO_MS, RANGO_POR_DEFECTO_MS } from './historial.ts'

const AHORA = 1_800_000_000_000
const leer = (consulta: string) => leerPedido(new URLSearchParams(consulta), AHORA)

describe('leerPedido (parámetros de /api/historial)', () => {
  it('sin desde ni hasta pide las últimas 24 horas de todos los sensores', () => {
    assert.deepEqual(leer('nodo=bancal1esp1'), {
      ok: true,
      pedido: { nodo: 'bancal1esp1', desde: AHORA - RANGO_POR_DEFECTO_MS, hasta: AHORA, tipo: null },
    })
  })

  it('respeta desde, hasta y tipo', () => {
    assert.deepEqual(leer('nodo=bancal1esp1&desde=1000&hasta=2000&tipo=temperatura_aire'), {
      ok: true,
      pedido: { nodo: 'bancal1esp1', desde: 1000, hasta: 2000, tipo: 'temperatura_aire' },
    })
  })

  it('rechaza lo que no corresponde', () => {
    const errores = [
      '', // sin nodo
      'nodo=a b',
      "nodo=x'; DROP TABLE historial_lecturas; --",
      'nodo=x&tipo=a.b',
      'nodo=x&desde=ayer',
      'nodo=x&desde=1.5&hasta=3',
      'nodo=x&desde=-5&hasta=3',
      'nodo=x&desde=2000&hasta=2000', // rango vacío
      `nodo=x&desde=0&hasta=${RANGO_MAXIMO_MS + 1}`, // más de 15 días
    ]
    for (const consulta of errores) assert.equal(leer(consulta).ok, false, consulta)
  })

  it('acepta justo 15 días', () => {
    assert.equal(leer(`nodo=x&desde=0&hasta=${RANGO_MAXIMO_MS}`).ok, true)
  })
})
