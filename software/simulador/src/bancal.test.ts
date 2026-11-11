import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearBancal, interpretarConfig, minutoEnZona } from './bancal.ts'
import { avanzar, estadoInicial, RITMO, type Sensores } from './modelo.ts'

const MEDIODIA_AR = Date.parse('2026-11-11T15:00:00Z') // 12:00 en Argentina
const lecturas = (cambios: Partial<Sensores> = {}): Sensores => ({ temperaturaAire: 24, humedadAire: 50, temperaturaSuelo: 22, humedadSuelo: 45, luz: 1, ...cambios })

function crear() {
  const estados: string[] = []
  const aplicadas: Record<string, unknown>[] = []
  const b = crearBancal({ estado: (a, p) => void estados.push(`${a}=${+p}`), aplicada: (j) => void aplicadas.push(JSON.parse(j)), log: () => {} })
  return { b, estados, aplicadas }
}
const config = (cambios: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 7, modo: 'automatico', riego: [20, 70], cooler: [28, 26], pulso: [5, 2], luz: null, tz: '<-03>3', ...cambios })

describe('interpretarConfig (el mismo JSON que recibe la placa)', () => {
  it('lee la configuración completa', () => {
    const c = interpretarConfig(config({ luz: ['18:00', '23:00'], pulso: [8, 3] }))
    assert.ok(typeof c !== 'string')
    assert.deepEqual(c.umbrales.luzHorario, { desde: '18:00', hasta: '23:00' })
    assert.equal(c.umbrales.riegoPulsoSegundos, 8)
  })
  it('rechaza lo que no sirve', () => {
    assert.equal(typeof interpretarConfig('hola'), 'string')
    assert.equal(typeof interpretarConfig(config({ modo: 'turbo' })), 'string')
    assert.equal(typeof interpretarConfig(config({ riego: [50, 52] })), 'string')
  })
})

describe('minutoEnZona', () => {
  it('UTC-3', () => assert.equal(minutoEnZona(MEDIODIA_AR, '<-03>3'), 12 * 60))
  it('UTC', () => assert.equal(minutoEnZona(MEDIODIA_AR, 'UTC0'), 15 * 60))
})

describe('reglas en el bancal simulado', () => {
  it('riega por pulsos: 5 s, espera 2 lecturas, y otra vez mientras siga seco', () => {
    const { b, estados } = crear()
    b.alLeer(lecturas({ humedadSuelo: 10 }), MEDIODIA_AR)
    assert.deepEqual(estados, ['riego=1'])
    b.alPasarElTiempo(MEDIODIA_AR + 5000)
    assert.deepEqual(estados, ['riego=1', 'riego=0'])
    b.alLeer(lecturas({ humedadSuelo: 15 }), MEDIODIA_AR + 6000)
    assert.equal(b.actuadores.riego, false) // primera lectura de espera
    b.alLeer(lecturas({ humedadSuelo: 18 }), MEDIODIA_AR + 11000)
    assert.equal(b.actuadores.riego, true) // terminó la espera y sigue seco: otro pulso
  })

  it('en automático ignora las órdenes; en manual las obedece', () => {
    const { b } = crear()
    b.alServicio(true, MEDIODIA_AR)
    b.alOrden('cooler', '1', MEDIODIA_AR)
    assert.equal(b.actuadores.cooler, false)
    b.alConfig(config({ modo: 'manual' }), MEDIODIA_AR)
    b.alOrden('cooler', '1', MEDIODIA_AR)
    assert.equal(b.actuadores.cooler, true)
  })

  it('en manual, si se cae el servicio pasa a automático y aplica las reglas', () => {
    const { b, aplicadas } = crear()
    b.alServicio(true, MEDIODIA_AR)
    b.alConfig(config({ modo: 'manual' }), MEDIODIA_AR)
    b.alLeer(lecturas({ luz: 1 }), MEDIODIA_AR)
    b.alOrden('luz', '1', MEDIODIA_AR)
    assert.equal(b.actuadores.luz, true)
    b.alServicio(false, MEDIODIA_AR + 1000)
    assert.equal(b.actuadores.luz, false) // hay luz: en automático la apaga
    assert.equal(aplicadas.at(-1)?.efectivo, 'automatico')
  })

  it('una configuración nueva se aplica enseguida', () => {
    const { b } = crear()
    b.alLeer(lecturas({ temperaturaAire: 27 }), MEDIODIA_AR)
    assert.equal(b.actuadores.cooler, false)
    b.alConfig(config({ cooler: [26, 24] }), MEDIODIA_AR)
    assert.equal(b.actuadores.cooler, true)
  })
})

describe('modelo', () => {
  const sinRuido = () => 0.5
  it('el riego sube la humedad del suelo y el tiempo la baja', () => {
    const s = estadoInicial(12 * 60)
    const regando = avanzar(s, 5, 12 * 60, { luz: false, cooler: false, riego: true }, sinRuido)
    const secando = avanzar(s, 5, 12 * 60, { luz: false, cooler: false, riego: false }, sinRuido)
    assert.ok(regando.humedadSuelo > s.humedadSuelo + 5 * RITMO.riego - 1)
    assert.ok(secando.humedadSuelo < s.humedadSuelo)
  })
  it('el cooler baja la temperatura', () => {
    const s = estadoInicial(15 * 60)
    let con = s, sin = s
    for (let i = 0; i < 60; i++) {
      con = avanzar(con, 5, 15 * 60, { luz: false, cooler: true, riego: false }, sinRuido)
      sin = avanzar(sin, 5, 15 * 60, { luz: false, cooler: false, riego: false }, sinRuido)
    }
    assert.ok(con.temperaturaAire < sin.temperaturaAire - 2)
  })
  it('hay luz de 7:00 a 19:30', () => {
    assert.equal(avanzar(estadoInicial(0), 1, 6 * 60 + 59, { luz: true, cooler: false, riego: false }).luz, 0)
    assert.equal(avanzar(estadoInicial(0), 1, 12 * 60, { luz: false, cooler: false, riego: false }).luz, 1)
  })
})
