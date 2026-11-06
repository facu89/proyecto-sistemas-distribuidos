/**
 * Estado de los actuadores de la home.
 *
 * Los ids coinciden con el {tipo} de los tópicos MQTT (`{nodoId}/actuador/{tipo}/...`),
 * así más adelante el estado real del bancal se puede volcar acá sin traducir nombres.
 */
export type Actuador = 'luz' | 'ventilador' | 'riego'

export type EstadoActuadores = Record<Actuador, boolean>

export const ESTADO_INICIAL: EstadoActuadores = {
  luz: false,
  ventilador: false,
  riego: false,
}
