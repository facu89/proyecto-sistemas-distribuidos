/**
 * Reglas del servicio: a partir de una lectura de sensor deciden si un actuador va encendido o apagado.
 *
 * Son funciones puras (no tocan MQTT ni guardan estado), así se prueban solas (reglas.test.ts).
 * El riego y el ventilador tienen histéresis: entre el umbral de encender y el de apagar, el actuador
 * sigue como estaba. Sin ese margen, una lectura que oscila alrededor de un único umbral lo prendería
 * y apagaría a cada rato.
 */

/** Los ids coinciden con el {tipo} de `{nodoId}/actuador/{tipo}/cmd` y con los de la web (estado.ts). */
export type Actuador = 'luz' | 'ventilador' | 'riego'

export const ACTUADORES: readonly Actuador[] = ['luz', 'ventilador', 'riego']

export type Umbrales = {
  /** Riego: se prende con humedad_suelo < este valor (%). */
  riegoEncenderDebajoDe: number
  /** Riego: se apaga con humedad_suelo >= este valor (%). */
  riegoApagarDesde: number
  /** Ventilador: se prende con temperatura_aire >= este valor (°C). */
  ventiladorEncenderDesde: number
  /** Ventilador: se apaga con temperatura_aire < este valor (°C). */
  ventiladorApagarDebajoDe: number
}

export type Decision = { actuador: Actuador; encendido: boolean }

/**
 * Decide el actuador que corresponde a un sensor.
 *
 * @param sensor   el {tipo} de `{nodoId}/sensor/{tipo}`
 * @param valor    la lectura; `null` si el ESP32 publicó "nan" (el sensor no respondió)
 * @param actual   estado actual del actuador: lo último que se le ordenó, o `null` si todavía nada
 * @returns la decisión, o `null` si este sensor no maneja ningún actuador o la lectura no sirve
 *          (en ese caso no se cambia nada).
 */
export function decidir(
  sensor: string,
  valor: number | null,
  actual: (actuador: Actuador) => boolean | null,
  umbrales: Umbrales,
): Decision | null {
  if (valor === null) return null

  switch (sensor) {
    // Digital: "1" con luz, "0" a oscuras. Si hay luz no hace falta prender la lámpara.
    case 'luz':
      if (valor === 1) return { actuador: 'luz', encendido: false }
      if (valor === 0) return { actuador: 'luz', encendido: true }
      return null

    case 'humedad_suelo':
      return {
        actuador: 'riego',
        encendido: conHisteresis(
          valor < umbrales.riegoEncenderDebajoDe,
          valor >= umbrales.riegoApagarDesde,
          actual('riego'),
        ),
      }

    case 'temperatura_aire':
      return {
        actuador: 'ventilador',
        encendido: conHisteresis(
          valor >= umbrales.ventiladorEncenderDesde,
          valor < umbrales.ventiladorApagarDebajoDe,
          actual('ventilador'),
        ),
      }

    default:
      return null
  }
}

/**
 * Entre los dos umbrales se mantiene el estado actual. Si todavía no se sabe (el servicio recién
 * arranca), se toma como apagado: es lo más seguro (no riega ni ventila sin necesidad) y se corrige
 * solo cuando la lectura cruce un umbral.
 */
function conHisteresis(encender: boolean, apagar: boolean, actual: boolean | null): boolean {
  if (encender) return true
  if (apagar) return false
  return actual ?? false
}
