import path from 'node:path'
import type { ConfigMysql } from './mysql.ts'
import { validarUmbrales, type HorarioLuz, type Umbrales } from './reglas.ts'

// Las rutas relativas se resuelven desde la carpeta del servicio (software/servicio), no desde donde se
// lanzó el proceso, así funciona igual con `pnpm start` que con `node software/servicio/src/main.ts`.
const CARPETA = path.resolve(import.meta.dirname, '..')

function texto(nombre: string, porDefecto?: string): string {
  const valor = process.env[nombre]?.trim()
  if (valor) return valor
  if (porDefecto !== undefined) return porDefecto
  throw new Error(`Falta la variable ${nombre} (debería venir de software/broker/secrets/servicio.env)`)
}

function numero(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre]?.trim()
  if (!crudo) return porDefecto
  const valor = Number(crudo)
  if (!Number.isFinite(valor)) throw new Error(`${nombre}="${crudo}" no es un número`)
  return valor
}

/** "18:00-23:00" -> { desde: '18:00', hasta: '23:00' }; vacío -> null (la luz depende solo de si está oscuro). */
function horario(nombre: string): HorarioLuz | null {
  const crudo = process.env[nombre]?.trim()
  if (!crudo) return null
  const [desde, hasta] = crudo.split('-').map((h) => h.trim())
  if (!desde || !hasta) throw new Error(`${nombre}="${crudo}" tiene que ser "HH:MM-HH:MM"`)
  return { desde, hasta }
}

const ruta = (nombre: string, porDefecto: string) => path.resolve(CARPETA, texto(nombre, porDefecto))

export function leerConfig() {
  const umbrales: Umbrales = {
    riegoEncenderDebajoDe: numero('RIEGO_ENCENDER_DEBAJO_DE', 20),
    riegoApagarDesde: numero('RIEGO_APAGAR_DESDE', 70),
    ventiladorEncenderDesde: numero('VENTILADOR_ENCENDER_DESDE', 28),
    ventiladorApagarDebajoDe: numero('VENTILADOR_APAGAR_DEBAJO_DE', 26),
    luzHorario: horario('LUZ_HORARIO'),
  }
  // Los mismos controles que cuando se cambian desde la web (márgenes mínimos, límites, formato de hora)
  const problema = validarUmbrales(umbrales)
  if (problema) throw new Error(`Valores por defecto de las reglas: ${problema}`)

  // MySQL: historial y configuración de cada bancal. Solo si hay a dónde conectarse: en compose
  // MYSQL_HOST=mysql; con `pnpm start` suelto no está, la web avisa que el historial no está disponible
  // y el modo y los rangos que se cambien no sobreviven a un reinicio.
  const mysqlHost = process.env.MYSQL_HOST?.trim()
  const claveMysql = process.env.MYSQL_SERVICIO_PASSWORD?.trim()
  const mysql: ConfigMysql | null =
    mysqlHost && claveMysql
      ? {
          host: mysqlHost,
          puerto: numero('MYSQL_PUERTO', 3306),
          usuario: texto('MYSQL_SERVICIO_USER', 'servicio'),
          clave: claveMysql,
          base: texto('MYSQL_DATABASE', 'mqtt'),
        }
      : null

  return {
    mqtt: {
      url: texto('MQTT_URL', 'mqtts://localhost:8883'),
      ca: ruta('MQTT_CA', '../broker/security/certs/ca.pem'),
      usuario: texto('MQTT_SERVICIO_USER'),
      clave: texto('MQTT_SERVICIO_PASSWORD'),
    },
    http: {
      puerto: numero('HTTP_PUERTO', 8080),
      host: texto('HTTP_HOST', '127.0.0.1'),
      webDist: ruta('WEB_DIST', '../../diseño_pagina_web/web/dist'),
    },
    umbrales,
    mysql,
    // El horario de la luz es en hora local del bancal; el servidor corre en UTC
    zonaHoraria: texto('ZONA_HORARIA', 'America/Argentina/Buenos_Aires'),
  }
}

export type Config = ReturnType<typeof leerConfig>
