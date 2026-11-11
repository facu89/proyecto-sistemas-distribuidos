/**
 * Conexión a MySQL del servicio, con el usuario "servicio" de MySQL: solo puede leer historial_lecturas y
 * leer/escribir configuracion_nodo (lo crea software/broker/mysql/actualizar.sh).
 */
import mysql from 'mysql2/promise'

export type ConfigMysql = { host: string; puerto: number; usuario: string; clave: string; base: string }

export type Pool = mysql.Pool

export function conectarMysql(config: ConfigMysql): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.puerto,
    user: config.usuario,
    password: config.clave,
    database: config.base,
    connectionLimit: 3,
    // Las horas (DATETIME) están en UTC: con 'Z', mysql2 manda y lee los Date en UTC sin depender de la
    // zona horaria de nadie.
    timezone: 'Z',
  })
}
