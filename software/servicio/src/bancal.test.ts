import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { crearBancales, type Bancales } from './bancal.ts'

const UMBRALES = { riegoEncenderDebajoDe: 20, riegoApagarDesde: 70, ventiladorEncenderDesde: 28, ventiladorApagarDebajoDe: 26 }

let publicadas: string[]
let bancales: Bancales

beforeEach(() => {
  publicadas = []
  bancales = crearBancales({
    umbrales: UMBRALES,
    publicar: async (nodo, actuador, encendido) => {
      publicadas.push(`${nodo}/actuador/${actuador}/cmd=${encendido ? 'on' : 'off'}`)
    },
  })
})

describe('órdenes', () => {
  it('publica la primera decisión y después solo los cambios', () => {
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '15')
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '14')
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '50')
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '72')
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '80')
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/riego/cmd=on', 'bancal1esp1/actuador/riego/cmd=off'])
  })

  it('con el servicio recién arrancado y lectura en la banda intermedia, ordena apagar una vez', () => {
    bancales.alMensaje('bancal1esp1/sensor/temperatura_aire', '27.0')
    bancales.alMensaje('bancal1esp1/sensor/temperatura_aire', '27.0')
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/ventilador/cmd=off'])
  })

  it('cada nodo tiene su propio estado', () => {
    bancales.alMensaje('bancal1esp1/sensor/luz', '0')
    bancales.alMensaje('bancal2esp1/sensor/luz', '0')
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/luz/cmd=on', 'bancal2esp1/actuador/luz/cmd=on'])
  })

  it('"nan" se guarda como null y no ordena nada', () => {
    bancales.alMensaje('bancal1esp1/sensor/temperatura_aire', 'nan')
    assert.deepEqual(publicadas, [])
    assert.equal(bancales.instantanea().nodos.bancal1esp1.lecturas.temperatura_aire.valor, null)
  })

  it('si la publicación falla, vuelve a intentar con la próxima lectura', async () => {
    let fallar = true
    const intentos: boolean[] = []
    const b = crearBancales({
      umbrales: UMBRALES,
      publicar: async (_n, _a, encendido) => {
        intentos.push(encendido)
        if (fallar) throw new Error('sin conexión')
      },
    })
    b.alMensaje('bancal1esp1/sensor/luz', '0')
    await new Promise((r) => setImmediate(r))
    assert.equal(b.instantanea().nodos.bancal1esp1.actuadores.luz.ordenado, null)
    fallar = false
    b.alMensaje('bancal1esp1/sensor/luz', '0')
    assert.deepEqual(intentos, [true, true])
    assert.equal(b.instantanea().nodos.bancal1esp1.actuadores.luz.ordenado, true)
  })
})

describe('presencia', () => {
  it('al volver online se reenvían las órdenes vigentes', () => {
    bancales.alMensaje('bancal1esp1/sensor/luz', '0')
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '10')
    publicadas = []
    bancales.alMensaje('bancal1esp1/presencia', 'offline')
    assert.deepEqual(publicadas, [])
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/luz/cmd=on', 'bancal1esp1/actuador/riego/cmd=on'])
    assert.equal(bancales.instantanea().nodos.bancal1esp1.presencia, 'online')
  })

  it('sin órdenes previas, online no publica nada', () => {
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    assert.deepEqual(publicadas, [])
  })
})

describe('estado real y mensajes raros', () => {
  it('guarda el /estado que informa el ESP32', () => {
    bancales.alMensaje('bancal1esp1/actuador/riego/estado', 'on')
    assert.equal(bancales.instantanea().nodos.bancal1esp1.actuadores.riego.real, true)
  })

  it('ignora tópicos y valores que no corresponden', () => {
    let avisos = 0
    bancales.alCambiar(() => avisos++)
    bancales.alMensaje('bancal1esp1/actuador/riego/estado', 'quizás')
    bancales.alMensaje('bancal1esp1/actuador/bomba/estado', 'on')
    bancales.alMensaje('bancal1esp1/otra/cosa', '1')
    bancales.alMensaje('bancal1esp1/presencia', 'dormido')
    assert.equal(bancales.instantanea().nodos.bancal1esp1?.actuadores.riego.real ?? null, null)
    assert.equal(bancales.instantanea().nodos.bancal1esp1?.presencia ?? null, null)
    assert.equal(avisos, 0)
  })

  it('avisa a los oyentes en cada cambio', () => {
    const recibidas: boolean[] = []
    bancales.alCambiar((i) => recibidas.push(i.broker))
    bancales.setBroker(true)
    bancales.setBroker(true) // sin cambio, no avisa
    bancales.alMensaje('bancal1esp1/sensor/humedad_aire', '60')
    assert.deepEqual(recibidas, [true, true])
  })
})
