/**
 * Reglas del servicio: a partir de una lectura de sensor deciden si un actuador va encendido o apagado.
 *
 * Son funciones puras (no tocan MQTT ni guardan estado), así se prueban solas (reglas.test.ts).
 * El riego y el ventilador tienen histéresis: entre el umbral de encender y el de apagar, el actuador
 * sigue como estaba. Sin ese margen, una lectura que oscila alrededor de un único umbral lo prendería
 * y apagaría a cada rato.
 */

/** Los ids coinciden con el {tipo} de `{nodoId}/actuador/{tipo}/cmd` y con los de la web (estado.ts). */
export type Actuador = 'luz' | 'cooler' | 'riego'

export const ACTUADORES: readonly Actuador[] = ['luz', 'cooler', 'riego']

/** Horario en hora local, "HH:MM". Si `hasta` es menor que `desde`, cruza la medianoche (20:00 a 02:00). */
export type HorarioLuz = { desde: string; hasta: string }

/**
 * Los rangos de un bancal. Cada bancal tiene los suyos (se editan desde la web y se guardan en MySQL); los
 * que no se tocaron usan los valores por defecto del servicio (.env).
 */
export type Umbrales = {
  /** Riego: se prende con humedad_suelo < este valor (%). */
  riegoEncenderDebajoDe: number
  /** Riego: se apaga con humedad_suelo >= este valor (%). */
  riegoApagarDesde: number
  /** Ventilador: se prende con temperatura_aire >= este valor (°C). */
  ventiladorEncenderDesde: number
  /** Ventilador: se apaga con temperatura_aire < este valor (°C). */
  ventiladorApagarDebajoDe: number
  /** Luz: si está, la lámpara solo prende a oscuras dentro de este horario; `null`, siempre que esté oscuro. */
  luzHorario: HorarioLuz | null
  /**
   * Riego por pulsos (lo aplica el ESP32, en automático y en manual): la bomba prende como mucho estos
   * segundos y después espera `riegoEsperaLecturas` lecturas (de 5 s) antes de poder volver a regar.
   */
  riegoPulsoSegundos: number
  riegoEsperaLecturas: number
}

/** Para los rangos guardados antes de que existieran los pulsos. */
export const PULSO_POR_DEFECTO = { riegoPulsoSegundos: 5, riegoEsperaLecturas: 2 } as const
export const LIMITES_PULSO: [number, number] = [1, 60]
export const LIMITES_ESPERA: [number, number] = [1, 60]

/** Diferencia mínima entre prender y apagar: con menos, el actuador prendería y apagaría a cada rato. */
export const MARGEN_RIEGO = 5
export const MARGEN_COOLER = 2
export const LIMITES_RIEGO: [number, number] = [0, 100]
export const LIMITES_COOLER: [number, number] = [0, 50]

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "18:30" -> 1110 (minutos desde la medianoche), o null si no es una hora válida. */
export function aMinutos(hora: string): number | null {
  const partes = HORA.exec(hora)
  return partes ? Number(partes[1]) * 60 + Number(partes[2]) : null
}

/** Si `minuto` (desde la medianoche) está en el horario: desde inclusive, hasta exclusive. */
export function dentroDelHorario(minuto: number, { desde, hasta }: HorarioLuz): boolean {
  const d = aMinutos(desde)!
  const h = aMinutos(hasta)!
  return d < h ? minuto >= d && minuto < h : minuto >= d || minuto < h
}

/** Minutos desde la medianoche en la zona horaria del bancal (el servidor corre en UTC). */
export function minutoLocal(instante: number, zonaHoraria: string): number {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone: zonaHoraria, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(instante)
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value)
  return valor('hour') * 60 + valor('minute')
}

/**
 * La zona horaria en formato POSIX, que es lo que entiende el ESP32 ("<-03>3" para Argentina, UTC-3).
 * Toma el desfasaje de ese momento: sirve para zonas sin horario de verano, como Argentina.
 */
export function zonaPosix(zonaHoraria: string, instante = Date.now()): string {
  const nombre = new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria, timeZoneName: 'longOffset' })
    .formatToParts(instante)
    .find((p) => p.type === 'timeZoneName')?.value
  const partes = /GMT([+-])(\d{2}):(\d{2})/.exec(nombre ?? '')
  if (!partes) return 'UTC0'
  const [, signo, hh, mm] = partes
  if (hh === '00' && mm === '00') return 'UTC0'
  const nombrePosix = `<${signo}${hh}${mm === '00' ? '' : mm}>`
  // En POSIX el signo va al revés: UTC-3 se escribe "3"
  const horas = `${signo === '-' ? '' : '-'}${Number(hh)}${mm === '00' ? '' : `:${mm}`}`
  return nombrePosix + horas
}

/** Revisa unos umbrales antes de usarlos o guardarlos. Devuelve el problema, o `null` si están bien. */
export function validarUmbrales(u: Umbrales): string | null {
  const numero = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (![u.riegoEncenderDebajoDe, u.riegoApagarDesde, u.ventiladorEncenderDesde, u.ventiladorApagarDebajoDe].every(numero)) {
    return 'Los umbrales tienen que ser números'
  }
  const [minR, maxR] = LIMITES_RIEGO
  if (u.riegoEncenderDebajoDe < minR || u.riegoApagarDesde > maxR) return `La humedad va de ${minR} a ${maxR} %`
  if (u.riegoApagarDesde - u.riegoEncenderDebajoDe < MARGEN_RIEGO) {
    return `El riego tiene que apagar al menos ${MARGEN_RIEGO} puntos arriba de donde prende`
  }
  const [minC, maxC] = LIMITES_COOLER
  if (u.ventiladorApagarDebajoDe < minC || u.ventiladorEncenderDesde > maxC) return `La temperatura va de ${minC} a ${maxC} °C`
  if (u.ventiladorEncenderDesde - u.ventiladorApagarDebajoDe < MARGEN_COOLER) {
    return `El cooler tiene que apagar al menos ${MARGEN_COOLER} °C debajo de donde prende`
  }
  const entero = (v: number, [min, max]: [number, number]) => Number.isInteger(v) && v >= min && v <= max
  if (!entero(u.riegoPulsoSegundos, LIMITES_PULSO)) return `El pulso de riego va de ${LIMITES_PULSO[0]} a ${LIMITES_PULSO[1]} segundos (entero)`
  if (!entero(u.riegoEsperaLecturas, LIMITES_ESPERA)) {
    return `La espera del riego va de ${LIMITES_ESPERA[0]} a ${LIMITES_ESPERA[1]} lecturas (entero)`
  }
  if (u.luzHorario !== null) {
    if (aMinutos(u.luzHorario.desde) === null || aMinutos(u.luzHorario.hasta) === null) {
      return 'El horario de la luz va en formato HH:MM'
    }
    if (u.luzHorario.desde === u.luzHorario.hasta) return 'El horario de la luz tiene que empezar y terminar a distinta hora'
  }
  return null
}

export type Decision = { actuador: Actuador; encendido: boolean }

/**
 * Decide el actuador que corresponde a un sensor.
 *
 * @param sensor   el {tipo} de `{nodoId}/sensor/{tipo}`
 * @param valor    la lectura; `null` si el ESP32 publicó "nan" (el sensor no respondió)
 * @param actual   estado actual del actuador: lo último que se le ordenó, o `null` si todavía nada
 * @param minuto   hora local en minutos desde la medianoche (para el horario de la luz)
 * @returns la decisión, o `null` si este sensor no maneja ningún actuador o la lectura no sirve
 *          (en ese caso no se cambia nada).
 */
export function decidir(
  sensor: string,
  valor: number | null,
  actual: (actuador: Actuador) => boolean | null,
  umbrales: Umbrales,
  minuto: number,
): Decision | null {
  if (valor === null) return null

  switch (sensor) {
    // Digital: "1" con luz, "0" a oscuras. Si hay luz no hace falta prender la lámpara. Con horario,
    // a oscuras prende solo dentro de ese horario (por ejemplo, para no tener la lámpara toda la noche).
    case 'luz':
      if (valor === 1) return { actuador: 'luz', encendido: false }
      if (valor === 0) {
        const enHorario = umbrales.luzHorario === null || dentroDelHorario(minuto, umbrales.luzHorario)
        return { actuador: 'luz', encendido: enHorario }
      }
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
        actuador: 'cooler',
        encendido: conHisteresis(
          valor >= umbrales.ventiladorEncenderDesde,
          valor < umbrales.ventiladorApagarDebajoDe,
          actual('cooler'),
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
