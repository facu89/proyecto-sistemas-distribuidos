import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { aAvisoConexion } from './webhooks.ts'

describe('aAvisoConexion', () => {
  it('conexión: sin motivo', () => {
    assert.deepEqual(
      aAvisoConexion({ event: 'client.connected', clientid: 'servicio', username: 'servicio', timestamp: 5 }),
      { tipo: 'conectado', clientid: 'servicio', usuario: 'servicio', motivo: null, instante: 5 },
    )
  })

  it('desconexión: traduce el reason conocido y deja tal cual el desconocido', () => {
    assert.equal(aAvisoConexion({ event: 'client.disconnected', clientid: 'a', reason: 'takenover' })?.motivo,
      'otro cliente se conectó con el mismo client ID')
    assert.equal(aAvisoConexion({ event: 'client.disconnected', clientid: 'a', reason: 'raro' })?.motivo, 'raro')
  })

  it('sin username ni timestamp: usuario null y la hora local', () => {
    const aviso = aAvisoConexion({ event: 'client.connected', clientid: 'a', username: '' }, 42)
    assert.equal(aviso?.usuario, null)
    assert.equal(aviso?.instante, 42)
  })

  it('ignora otros eventos y cuerpos inválidos', () => {
    assert.equal(aAvisoConexion({ event: 'message.publish', clientid: 'a' }), null)
    assert.equal(aAvisoConexion({ event: 'client.connected' }), null)
    assert.equal(aAvisoConexion(null), null)
    assert.equal(aAvisoConexion('texto'), null)
  })
})
