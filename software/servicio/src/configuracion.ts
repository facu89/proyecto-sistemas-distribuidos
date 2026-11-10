/**
 * Configuración de cada bancal que se cambia desde la web (modo y rangos), guardada en la tabla
 * configuracion_nodo de MySQL. El servicio la carga al arrancar: si se reinicia, cada bancal sigue con
 * su modo y sus rangos.
 */
import type { RowDataPacket } from 'mysql2/promise'
import type { Almacen, ConfigNodo } from './bancal.ts'
import type { Pool } from './mysql.ts'
import { validarUmbrales, type Umbrales } from './reglas.ts'

export type { Almacen, ConfigNodo }

export function crearAlmacen(pool: Pool, log: (mensaje: string) => void = () => {}): Almacen {
  return {
    async cargar() {
      const [filas] = await pool.query<RowDataPacket[]>(
        'SELECT nodo, modo, umbrales FROM configuracion_nodo',
      )
      const configuracion: Record<string, ConfigNodo> = {}
      for (const fila of filas) {
        // mysql2 ya devuelve la columna JSON como objeto. Si alguien la editó a mano y quedó inválida,
        // ese bancal vuelve a los valores por defecto en vez de usar algo que no tiene sentido.
        let umbrales = (fila.umbrales ?? null) as Umbrales | null
        if (umbrales !== null) {
          umbrales = { ...umbrales, luzHorario: umbrales.luzHorario ?? null }
          const problema = validarUmbrales(umbrales)
          if (problema) {
            log(`Los rangos guardados de ${fila.nodo} no sirven (${problema}): se usan los de por defecto`)
            umbrales = null
          }
        }
        configuracion[fila.nodo as string] = { modo: fila.modo === 'manual' ? 'manual' : 'automatico', umbrales }
      }
      return configuracion
    },

    async guardar(nodoId, { modo, umbrales }) {
      await pool.query(
        `INSERT INTO configuracion_nodo (nodo, modo, umbrales) VALUES (?, ?, ?) AS nuevo
         ON DUPLICATE KEY UPDATE modo = nuevo.modo, umbrales = nuevo.umbrales`,
        [nodoId, modo, umbrales === null ? null : JSON.stringify(umbrales)],
      )
    },
  }
}
