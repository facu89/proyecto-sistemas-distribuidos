import path from 'node:path'
import type { ConfigHistorial } from './historial.ts'
import type { Umbrales } from './reglas.ts'

// Las rutas relativas se resuelven desde la carpeta del servicio (software/servicio), no desde donde se
// lanzó el proceso, así funciona igual con `pnpm start` que con `node software/servicio/src/main.ts`.
const CARPETA = path.resolve(import.meta.dirname, '..')

function texto(nombre: string, porDefecto?: string): string {
  const valor = process.env[nombre]?.trim()
  if (valor) return valor
  if (porDefecto !== undefined) return porDefecto
  throw new Error(`Falta la variable ${nombre} (debería venir de software/broker/secrets/.env)`)
}

function numero(nombre: string, porDefecto: number): number {
  const crudo = process.env[nombre]?.trim()
  if (!crudo) return porDefecto
  const valor = Number(crudo)
  if (!Number.isFinite(valor)) throw new Error(`${nombre}="${crudo}" no es un número`)
  return valor
}

const ruta = (nombre: string, porDefecto: string) => path.resolve(CARPETA, texto(nombre, porDefecto))

export function leerConfig() {
  const umbrales: Umbrales = {
    riegoEncenderDebajoDe: numero('RIEGO_ENCENDER_DEBAJO_DE', 20),
    riegoApagarDesde: numero('RIEGO_APAGAR_DESDE', 70),
    ventiladorEncenderDesde: numero('VENTILADOR_ENCENDER_DESDE', 28),
    ventiladorApagarDebajoDe: numero('VENTILADOR_APAGAR_DEBAJO_DE', 26),
  }
  // Sin margen entre encender y apagar, el actuador prendería y apagaría con cada lectura.
  if (umbrales.riegoEncenderDebajoDe >= umbrales.riegoApagarDesde) {
    throw new Error('RIEGO_ENCENDER_DEBAJO_DE tiene que ser menor que RIEGO_APAGAR_DESDE')
  }
  if (umbrales.ventiladorApagarDebajoDe > umbrales.ventiladorEncenderDesde) {
    throw new Error('VENTILADOR_APAGAR_DEBAJO_DE no puede ser mayor que VENTILADOR_ENCENDER_DESDE')
  }

  // Historial (MySQL): solo si hay a dónde conectarse. En compose MYSQL_HOST=mysql; con `pnpm start`
  // suelto no está y la web avisa que el historial no está disponible.
  const mysqlHost = process.env.MYSQL_HOST?.trim()
  const claveLector = process.env.MYSQL_LECTOR_PASSWORD?.trim()
  const historial: ConfigHistorial | null =
    mysqlHost && claveLector
      ? {
          host: mysqlHost,
          puerto: numero('MYSQL_PUERTO', 3306),
          usuario: texto('MYSQL_LECTOR_USER', 'lector'),
          clave: claveLector,
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
    historial,
  }
}

export type Config = ReturnType<typeof leerConfig>
