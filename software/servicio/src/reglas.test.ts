import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decidir, type Actuador, type Umbrales } from './reglas.ts'

const UMBRALES: Umbrales = {
  riegoEncenderDebajoDe: 20,
  riegoApagarDesde: 70,
  ventiladorEncenderDesde: 28,
  ventiladorApagarDebajoDe: 26,
}

const conEstado = (estado: boolean | null) => (_: Actuador) => estado
const encendido = (sensor: string, valor: number | null, estado: boolean | null = null) =>
  decidir(sensor, valor, conEstado(estado), UMBRALES)?.encendido

describe('luz', () => {
  it('con luz (1) apaga la lámpara', () => assert.equal(encendido('luz', 1), false))
  it('a oscuras (0) la prende', () => assert.equal(encendido('luz', 0), true))
  it('ignora valores que no son 0 ni 1', () => assert.equal(decidir('luz', 0.5, conEstado(null), UMBRALES), null))
  it('maneja el actuador luz', () => assert.equal(decidir('luz', 0, conEstado(null), UMBRALES)?.actuador, 'luz'))
})

describe('riego (prende < 20 %, apaga >= 70 %)', () => {
  it('prende debajo de 20', () => assert.equal(encendido('humedad_suelo', 19), true))
  it('20 justo no prende si estaba apagado', () => assert.equal(encendido('humedad_suelo', 20, false), false))
  it('entre 20 y 70 sigue regando si ya regaba', () => assert.equal(encendido('humedad_suelo', 50, true), true))
  it('entre 20 y 70 sigue apagado si estaba apagado', () => assert.equal(encendido('humedad_suelo', 50, false), false))
  it('entre 20 y 70 sin estado previo queda apagado', () => assert.equal(encendido('humedad_suelo', 50, null), false))
  it('apaga en 70', () => assert.equal(encendido('humedad_suelo', 70, true), false))
  it('apaga arriba de 70', () => assert.equal(encendido('humedad_suelo', 85, true), false))
  it('maneja el actuador riego', () =>
    assert.equal(decidir('humedad_suelo', 10, conEstado(null), UMBRALES)?.actuador, 'riego'))
})

describe('ventilador (prende >= 28 °C, apaga < 26 °C)', () => {
  it('prende en 28', () => assert.equal(encendido('temperatura_aire', 28, false), true))
  it('27 no lo prende si estaba apagado', () => assert.equal(encendido('temperatura_aire', 27, false), false))
  it('entre 26 y 28 sigue encendido si ya lo estaba', () => assert.equal(encendido('temperatura_aire', 26, true), true))
  it('apaga debajo de 26', () => assert.equal(encendido('temperatura_aire', 25.9, true), false))
  it('maneja el actuador ventilador', () =>
    assert.equal(decidir('temperatura_aire', 30, conEstado(null), UMBRALES)?.actuador, 'ventilador'))
})

describe('lecturas que no deciden nada', () => {
  it('nan (null) no cambia nada', () => {
    for (const sensor of ['luz', 'humedad_suelo', 'temperatura_aire']) {
      assert.equal(decidir(sensor, null, conEstado(true), UMBRALES), null, sensor)
    }
  })
  it('sensores sin regla', () => {
    assert.equal(decidir('humedad_aire', 90, conEstado(null), UMBRALES), null)
    assert.equal(decidir('temperatura_suelo', 40, conEstado(null), UMBRALES), null)
  })
})
