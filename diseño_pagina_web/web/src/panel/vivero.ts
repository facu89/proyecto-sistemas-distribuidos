/**
 * Estado de cada bancal y del vivero entero, para el selector (SelectorBancal.tsx).
 * Sin React, así se puede probar suelto.
 */

/** Lo mínimo de cada bancal que hace falta (es compatible con `ResumenNodo` de bancal.ts). */
export type EstadoBancal = {
  presencia: 'online' | 'offline' | null
  /** Si hay una alerta activa de este nodo. */
  alerta: boolean
}

export type Tono = 'ok' | 'error' | 'apagado'

export function estadoNodo({ presencia, alerta }: EstadoBancal): { tono: Tono; texto: string } {
  if (alerta) return { tono: 'error', texto: 'Caído' }
  if (presencia === 'online') return { tono: 'ok', texto: 'En línea' }
  if (presencia === 'offline') return { tono: 'error', texto: 'Desconectado' }
  return { tono: 'apagado', texto: 'Sin datos' }
}

/**
 * Punto y texto del botón del vivero:
 * - rojo si algún bancal está caído;
 * - verde solo si hay al menos uno en línea (y ninguno caído);
 * - gris si no hay ninguno en línea (sin bancales, o todos sin datos).
 */
export function resumenVivero(lista: EstadoBancal[]): { tono: Tono; texto: string } {
  const tonos = lista.map((n) => estadoNodo(n).tono)
  const enLinea = tonos.filter((t) => t === 'ok').length
  const caidos = tonos.filter((t) => t === 'error').length
  const sinDatos = tonos.length - enLinea - caidos

  if (lista.length === 0) return { tono: 'apagado', texto: 'Todavía no se conectó ningún bancal' }
  if (enLinea === lista.length) return { tono: 'ok', texto: lista.length === 1 ? 'En línea' : 'Todos en línea' }

  const partes = [
    enLinea > 0 && `${enLinea} en línea`,
    caidos > 0 && `${caidos} con problemas`,
    sinDatos > 0 && `${sinDatos} sin datos`,
  ].filter(Boolean)
  return { tono: caidos > 0 ? 'error' : enLinea > 0 ? 'ok' : 'apagado', texto: partes.join(', ') }
}
