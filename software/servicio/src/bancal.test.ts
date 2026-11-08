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
      publicadas.push(`${nodo}/actuador/${actuador}/cmd=${encendido ? '1' : '0'}`)
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
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/riego/cmd=1', 'bancal1esp1/actuador/riego/cmd=0'])
  })

  it('con el servicio recién arrancado y lectura en la banda intermedia, ordena apagar una vez', () => {
    bancales.alMensaje('bancal1esp1/sensor/temperatura_aire', '27.0')
    bancales.alMensaje('bancal1esp1/sensor/temperatura_aire', '27.0')
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/cooler/cmd=0'])
  })

  it('cada nodo tiene su propio estado', () => {
    bancales.alMensaje('bancal1esp1/sensor/luz', '0')
    bancales.alMensaje('bancal2esp1/sensor/luz', '0')
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/luz/cmd=1', 'bancal2esp1/actuador/luz/cmd=1'])
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
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/luz/cmd=1', 'bancal1esp1/actuador/riego/cmd=1'])
    assert.equal(bancales.instantanea().nodos.bancal1esp1.presencia, 'online')
  })

  it('sin órdenes previas, online no publica nada', () => {
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    assert.deepEqual(publicadas, [])
  })
})

describe('estado real y mensajes raros', () => {
  it('guarda el /estado que informa el ESP32', () => {
    bancales.alMensaje('bancal1esp1/actuador/riego/estado', '1')
    assert.equal(bancales.instantanea().nodos.bancal1esp1.actuadores.riego.real, true)
  })

  it('ignora tópicos y valores que no corresponden', () => {
    let avisos = 0
    bancales.alCambiar(() => avisos++)
    bancales.alMensaje('bancal1esp1/actuador/riego/estado', 'quizás')
    bancales.alMensaje('bancal1esp1/actuador/riego/estado', 'on')
    bancales.alMensaje('bancal1esp1/actuador/bomba/estado', '1')
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

describe('modo manual / automático', () => {
  it('cada nodo arranca en automático', () => {
    bancales.alMensaje('bancal1esp1/sensor/luz', '1')
    assert.equal(bancales.instantanea().nodos.bancal1esp1.modo, 'automatico')
  })

  it('en manual las lecturas se guardan pero no ordenan', () => {
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    assert.deepEqual(bancales.setModo('bancal1esp1', 'manual'), { ok: true })
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '10')
    assert.deepEqual(publicadas, [])
    assert.equal(bancales.instantanea().nodos.bancal1esp1.lecturas.humedad_suelo.valor, 10)
  })

  it('en manual la web ordena; en automático se rechaza', () => {
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    const rechazo = bancales.ordenarManual('bancal1esp1', 'cooler', true)
    assert.equal(rechazo.ok, false)
    assert.equal(!rechazo.ok && rechazo.codigo, 409)
    bancales.setModo('bancal1esp1', 'manual')
    assert.deepEqual(bancales.ordenarManual('bancal1esp1', 'cooler', true), { ok: true })
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/cooler/cmd=1'])
    assert.equal(bancales.instantanea().nodos.bancal1esp1.actuadores.cooler.ordenado, true)
  })

  it('nodo desconocido: 404', () => {
    const r = bancales.setModo('no-existe', 'manual')
    assert.equal(!r.ok && r.codigo, 404)
  })

  it('al volver a automático aplica las reglas con las últimas lecturas', () => {
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    bancales.setModo('bancal1esp1', 'manual')
    bancales.alMensaje('bancal1esp1/sensor/luz', '0') // a oscuras
    bancales.alMensaje('bancal1esp1/sensor/temperatura_aire', '30')
    bancales.ordenarManual('bancal1esp1', 'luz', false)
    publicadas = []
    bancales.setModo('bancal1esp1', 'automatico')
    assert.deepEqual(publicadas.sort(), ['bancal1esp1/actuador/cooler/cmd=1', 'bancal1esp1/actuador/luz/cmd=1'])
  })

  it('al volver a automático, en la banda de histéresis queda lo que se puso a mano', () => {
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    bancales.setModo('bancal1esp1', 'manual')
    bancales.alMensaje('bancal1esp1/sensor/humedad_suelo', '50')
    bancales.ordenarManual('bancal1esp1', 'riego', true)
    publicadas = []
    bancales.setModo('bancal1esp1', 'automatico')
    assert.deepEqual(publicadas, [])
    assert.equal(bancales.instantanea().nodos.bancal1esp1.actuadores.riego.ordenado, true)
  })

  it('las órdenes manuales también se reenvían cuando el nodo se reconecta', () => {
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    bancales.setModo('bancal1esp1', 'manual')
    bancales.ordenarManual('bancal1esp1', 'luz', true)
    publicadas = []
    bancales.alMensaje('bancal1esp1/presencia', 'online')
    assert.deepEqual(publicadas, ['bancal1esp1/actuador/luz/cmd=1'])
  })
})

describe('alertas', () => {
  it('guarda la alerta por tópico y separa activa y desde del resto de los datos', () => {
    bancales.alMensaje('alertas/nodo_offline/bancal1esp1', '{"nodo": "bancal1esp1", "activa": true, "desde": 1700000000000}')
    assert.deepEqual(bancales.instantanea().alertas, {
      'nodo_offline/bancal1esp1': { activa: true, desde: 1700000000000, datos: { nodo: 'bancal1esp1' } },
    })
    // No crea un nodo llamado "alertas"
    assert.deepEqual(bancales.instantanea().nodos, {})
  })

  it('una alerta resuelta reemplaza a la activa y un payload vacío la borra', () => {
    bancales.alMensaje('alertas/servicio', '{"activa": true, "motivo": "se detuvo", "desde": 1}')
    bancales.alMensaje('alertas/servicio', '{"activa": false, "motivo": "volvió a conectarse", "desde": 2}')
    assert.equal(bancales.instantanea().alertas.servicio.activa, false)
    bancales.alMensaje('alertas/servicio', '')
    assert.deepEqual(bancales.instantanea().alertas, {})
  })

  it('ignora payloads que no son JSON o no traen "activa"', () => {
    bancales.alMensaje('alertas/servicio', 'hola')
    bancales.alMensaje('alertas/servicio', '{"motivo": "x"}')
    assert.deepEqual(bancales.instantanea().alertas, {})
  })
})
