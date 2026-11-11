/**
 * Pedidos al servicio (ver software/servicio/src/http.ts). La respuesta no trae el estado nuevo:
 * llega por SSE (useBancal) a todas las pestañas abiertas, también a esta.
 */
import type { Modo } from '../../../software/servicio/src/bancal.ts'
import type { Umbrales } from '../../../software/servicio/src/reglas.ts'
import type { Actuador } from './estado'

export type { Modo }

async function post(ruta: string, cuerpo: unknown): Promise<void> {
  let respuesta: Response
  try {
    respuesta = await fetch(ruta, {
      method: 'POST',
      // JSON obligatorio: el servicio rechaza otros tipos (protección contra pedidos de otras páginas).
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
  } catch {
    throw new Error('No se pudo contactar al servicio')
  }
  if (respuesta.ok) return
  const datos = (await respuesta.json().catch(() => null)) as { error?: string } | null
  throw new Error(datos?.error ?? `El servicio respondió ${respuesta.status}`)
}

const nodo = (nodoId: string) => `/api/nodos/${encodeURIComponent(nodoId)}`

export const cambiarModo = (nodoId: string, modo: Modo) => post(`${nodo(nodoId)}/modo`, { modo })

/** Los rangos del bancal; `null` vuelve a los de por defecto del servicio. */
export const cambiarUmbrales = (nodoId: string, umbrales: Umbrales | null) => post(`${nodo(nodoId)}/umbrales`, { umbrales })

/** Solo funciona con el nodo en manual. */
export const ordenarActuador = (nodoId: string, actuador: Actuador, encendido: boolean) =>
  post(`${nodo(nodoId)}/actuadores/${actuador}`, { encendido })
