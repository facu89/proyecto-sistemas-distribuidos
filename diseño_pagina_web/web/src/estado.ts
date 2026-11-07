/**
 * Estado de los actuadores que dibuja la escena.
 *
 * Los ids coinciden con el {tipo} de los tópicos MQTT (`{nodoId}/actuador/{tipo}/...`) y con los
 * del servicio, así el estado del bancal se vuelca acá sin traducir nombres (ver bancal.ts).
 */
export type Actuador = 'luz' | 'cooler' | 'riego'

export type EstadoActuadores = Record<Actuador, boolean>
