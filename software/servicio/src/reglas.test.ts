import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decidir, dentroDelHorario, minutoLocal, validarUmbrales, zonaPosix, type Actuador, type Umbrales } from './reglas.ts'

const UMBRALES: Umbrales = {
  riegoEncenderDebajoDe: 20,
  riegoApagarDesde: 70,
  ventiladorEncenderDesde: 28,
  ventiladorApagarDebajoDe: 26,
  luzHorario: null,
}
const MEDIODIA = 12 * 60

const conEstado = (estado: boolean | null) => (_: Actuador) => estado
const encendido = (sensor: string, valor: number | null, estado: boolean | null = null) =>
  decidir(sensor, valor, conEstado(estado), UMBRALES, MEDIODIA)?.encendido

describe('luz', () => {
  it('con luz (1) apaga la lámpara', () => assert.equal(encendido('luz', 1), false))
  it('a oscuras (0) la prende', () => assert.equal(encendido('luz', 0), true))
  it('ignora valores que no son 0 ni 1', () => assert.equal(decidir('luz', 0.5, conEstado(null), UMBRALES, MEDIODIA), null))
  it('maneja el actuador luz', () => assert.equal(decidir('luz', 0, conEstado(null), UMBRALES, MEDIODIA)?.actuador, 'luz'))
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
    assert.equal(decidir('humedad_suelo', 10, conEstado(null), UMBRALES, MEDIODIA)?.actuador, 'riego'))
})

describe('ventilador (prende >= 28 °C, apaga < 26 °C)', () => {
  it('prende en 28', () => assert.equal(encendido('temperatura_aire', 28, false), true))
  it('27 no lo prende si estaba apagado', () => assert.equal(encendido('temperatura_aire', 27, false), false))
  it('entre 26 y 28 sigue encendido si ya lo estaba', () => assert.equal(encendido('temperatura_aire', 26, true), true))
  it('apaga debajo de 26', () => assert.equal(encendido('temperatura_aire', 25.9, true), false))
  it('maneja el actuador cooler', () =>
    assert.equal(decidir('temperatura_aire', 30, conEstado(null), UMBRALES, MEDIODIA)?.actuador, 'cooler'))
})

describe('lecturas que no deciden nada', () => {
  it('nan (null) no cambia nada', () => {
    for (const sensor of ['luz', 'humedad_suelo', 'temperatura_aire']) {
      assert.equal(decidir(sensor, null, conEstado(true), UMBRALES, MEDIODIA), null, sensor)
    }
  })
  it('sensores sin regla', () => {
    assert.equal(decidir('humedad_aire', 90, conEstado(null), UMBRALES, MEDIODIA), null)
    assert.equal(decidir('temperatura_suelo', 40, conEstado(null), UMBRALES, MEDIODIA), null)
  })
})

describe('luz con horario (18:00 a 23:00)', () => {
  const conHorario: Umbrales = { ...UMBRALES, luzHorario: { desde: '18:00', hasta: '23:00' } }
  const luz = (valor: number, hora: string) => {
    const [h, m] = hora.split(':').map(Number)
    return decidir('luz', valor, conEstado(null), conHorario, h * 60 + m)?.encendido
  }
  it('a oscuras dentro del horario prende', () => assert.equal(luz(0, '20:00'), true))
  it('a oscuras fuera del horario no prende', () => assert.equal(luz(0, '02:00'), false))
  it('justo al empezar prende y justo al terminar apaga', () => {
    assert.equal(luz(0, '18:00'), true)
    assert.equal(luz(0, '23:00'), false)
  })
  it('con luz nunca prende, aunque sea el horario', () => assert.equal(luz(1, '20:00'), false))
})

describe('dentroDelHorario', () => {
  it('cruzando la medianoche (22:00 a 06:00)', () => {
    const horario = { desde: '22:00', hasta: '06:00' }
    assert.equal(dentroDelHorario(23 * 60, horario), true)
    assert.equal(dentroDelHorario(3 * 60, horario), true)
    assert.equal(dentroDelHorario(12 * 60, horario), false)
  })
})

describe('minutoLocal', () => {
  it('pasa de UTC a la hora de Argentina (UTC-3)', () => {
    assert.equal(minutoLocal(Date.parse('2026-11-10T02:30:00Z'), 'America/Argentina/Buenos_Aires'), 23 * 60 + 30)
  })
})

describe('validarUmbrales', () => {
  const con = (cambios: Partial<Umbrales>) => validarUmbrales({ ...UMBRALES, ...cambios })
  it('los valores por defecto son válidos', () => assert.equal(validarUmbrales(UMBRALES), null))
  it('el riego necesita 5 puntos entre prender y apagar', () => {
    assert.equal(con({ riegoEncenderDebajoDe: 30, riegoApagarDesde: 35 }), null)
    assert.notEqual(con({ riegoEncenderDebajoDe: 30, riegoApagarDesde: 34 }), null)
    assert.notEqual(con({ riegoEncenderDebajoDe: 70, riegoApagarDesde: 20 }), null)
  })
  it('el cooler necesita 2 °C entre prender y apagar', () => {
    assert.equal(con({ ventiladorEncenderDesde: 30, ventiladorApagarDebajoDe: 28 }), null)
    assert.notEqual(con({ ventiladorEncenderDesde: 30, ventiladorApagarDebajoDe: 29 }), null)
  })
  it('fuera de los límites o no numéricos', () => {
    assert.notEqual(con({ riegoApagarDesde: 101 }), null)
    assert.notEqual(con({ ventiladorEncenderDesde: 55 }), null)
    assert.notEqual(con({ riegoEncenderDebajoDe: Number.NaN }), null)
  })
  it('el horario de la luz', () => {
    assert.equal(con({ luzHorario: { desde: '20:00', hasta: '02:00' } }), null)
    assert.notEqual(con({ luzHorario: { desde: '25:00', hasta: '02:00' } }), null)
    assert.notEqual(con({ luzHorario: { desde: '8:00', hasta: '10:00' } }), null)
    assert.notEqual(con({ luzHorario: { desde: '10:00', hasta: '10:00' } }), null)
  })
})

describe('zonaPosix (lo que entiende el ESP32)', () => {
  it('Argentina, UTC y una zona con media hora', () => {
    assert.equal(zonaPosix('America/Argentina/Buenos_Aires'), '<-03>3')
    assert.equal(zonaPosix('UTC'), 'UTC0')
    assert.equal(zonaPosix('Asia/Kolkata'), '<+0530>-5:30')
  })
})
