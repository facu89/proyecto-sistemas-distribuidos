/**
 * Forma de los datos de `GET /api/historial`. Está aparte de historial.ts para que la web pueda importar
 * los tipos sin arrastrar mysql2 (lo mismo que hace con bancal.ts).
 */

/** `[instante en ms desde 1970, valor]`: así el JSON queda corto (14 días son ~10.000 puntos). */
export type Punto = [instante: number, valor: number]

export type Historial = {
  nodo: string
  desde: number
  hasta: number
  /** Por tipo de sensor (temperatura_aire, humedad_suelo...), ordenados del más viejo al más nuevo. */
  series: Record<string, Punto[]>
}

/** Qué se pide: lecturas de `nodo` con `desde <= instante < hasta` (ms), de un sensor o de todos. */
export type PedidoHistorial = { nodo: string; desde: number; hasta: number; tipo: string | null }
