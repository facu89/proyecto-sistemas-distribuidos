/**
 * El bancal simulado: sensores que cambian con el tiempo y responden a los actuadores, para que las reglas
 * tengan algo real que hacer. No pretende ser preciso, solo creíble:
 *
 * - Temperatura del aire: sube de día y baja de noche (de ~18 °C de madrugada a ~31 °C a la tarde); el
 *   cooler la baja unos grados.
 * - Humedad del aire: al revés que la temperatura.
 * - Humedad del suelo: se va secando de a poco; cada segundo de riego la sube.
 * - Temperatura del suelo: sigue a la del aire, más lenta.
 * - Luz: hay luz entre las 7:00 y las 19:30 (hora local). La lámpara no cuenta: el sensor simulado mide
 *   solo la luz del día (en la placa real, el LDR sí podría ver la lámpara).
 */

export type Actuadores = { luz: boolean; cooler: boolean; riego: boolean }

export type Sensores = {
  temperaturaAire: number
  humedadAire: number
  temperaturaSuelo: number
  humedadSuelo: number
  luz: 0 | 1
}

/** Cuánto cambian las cosas (por segundo). Exportado para los tests. */
export const RITMO = {
  /** El suelo pierde 1 punto de humedad cada ~2 minutos: en una hora pasa de 70 % a ~40 %. */
  secadoSuelo: 0.008,
  /** Cada segundo de riego suma 1,5 puntos: un pulso de 5 s, ~7,5 %. */
  riego: 1.5,
  /** Cuánto baja la temperatura con el cooler prendido. */
  enfriamientoCooler: 4,
  /** Qué tan rápido la temperatura se acerca a la que "debería" tener (0 a 1 por segundo). */
  inercia: 0.02,
}

/** Temperatura del aire según la hora (minutos desde la medianoche): mínima a las 6, máxima a las 15. */
export function temperaturaDelDia(minuto: number): number {
  const fase = ((minuto / 60 - 15) / 24) * 2 * Math.PI
  return 24.5 + 6.5 * Math.cos(fase)
}

export const hayLuzNatural = (minuto: number) => minuto >= 7 * 60 && minuto < 19 * 60 + 30

export function estadoInicial(minuto: number): Sensores {
  const t = temperaturaDelDia(minuto)
  return { temperaturaAire: t, humedadAire: humedadAireSegun(t), temperaturaSuelo: t - 1, humedadSuelo: 45, luz: hayLuzNatural(minuto) ? 1 : 0 }
}

const humedadAireSegun = (temperatura: number) => Math.min(90, Math.max(20, 95 - 2.2 * temperatura))
const acotar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Avanza la simulación `segundos` (con los actuadores como están) y devuelve los sensores nuevos.
 * `ruido` (por defecto Math.random) se puede fijar en los tests.
 */
export function avanzar(s: Sensores, segundos: number, minuto: number, a: Actuadores, ruido: () => number = Math.random): Sensores {
  const objetivo = temperaturaDelDia(minuto) - (a.cooler ? RITMO.enfriamientoCooler : 0)
  const acercar = Math.min(1, RITMO.inercia * segundos)
  const temperaturaAire = s.temperaturaAire + (objetivo - s.temperaturaAire) * acercar + (ruido() - 0.5) * 0.1
  const humedadSuelo = acotar(s.humedadSuelo - RITMO.secadoSuelo * segundos + (a.riego ? RITMO.riego * segundos : 0), 0, 100)
  return {
    temperaturaAire,
    humedadAire: acotar(humedadAireSegun(temperaturaAire) + (ruido() - 0.5) * 2, 0, 100),
    temperaturaSuelo: s.temperaturaSuelo + (temperaturaAire - 1 - s.temperaturaSuelo) * acercar * 0.3,
    humedadSuelo,
    luz: hayLuzNatural(minuto) ? 1 : 0,
  }
}
