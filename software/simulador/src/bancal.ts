/**
 * Lo que en la placa hace firmware/src/main.cpp: aplica las reglas con la configuración que manda el
 * servicio, riega por pulsos, y en manual pasa a automático si se pierde el servicio. Las reglas son las
 * del servicio (software/servicio/src/reglas.ts), las mismas que firmware/src/reglas.c.
 *
 * No sabe nada de MQTT: main.ts le pasa los mensajes y publica lo que esto pide (así se prueba solo).
 */
import {
  decidir,
  PULSO_POR_DEFECTO,
  validarUmbrales,
  type Actuador,
  type Umbrales,
} from '../../servicio/src/reglas.ts'
import type { Actuadores, Sensores } from './modelo.ts'

export type Modo = 'automatico' | 'manual'

export type Configuracion = { v: number; modo: Modo; umbrales: Umbrales; tz: string }

export const CONFIG_POR_DEFECTO: Configuracion = {
  v: 0,
  modo: 'automatico',
  umbrales: {
    riegoEncenderDebajoDe: 20,
    riegoApagarDesde: 70,
    ventiladorEncenderDesde: 28,
    ventiladorApagarDebajoDe: 26,
    luzHorario: null,
    ...PULSO_POR_DEFECTO,
  },
  tz: '<-03>3',
}

/** Interpreta `{nodoId}/config` (el mismo JSON que recibe la placa). Devuelve la configuración o el problema. */
export function interpretarConfig(texto: string): Configuracion | string {
  let j: { v?: unknown; modo?: unknown; riego?: unknown; cooler?: unknown; pulso?: unknown; luz?: unknown; tz?: unknown }
  try {
    j = JSON.parse(texto)
  } catch {
    return 'no es JSON'
  }
  if (j.modo !== 'automatico' && j.modo !== 'manual') return 'modo desconocido'
  const par = (v: unknown) => (Array.isArray(v) && v.length === 2 ? (v as [unknown, unknown]) : null)
  const riego = par(j.riego), cooler = par(j.cooler), pulso = par(j.pulso), luz = par(j.luz)
  if (!riego || !cooler) return 'faltan los rangos de riego o cooler'
  const umbrales: Umbrales = {
    riegoEncenderDebajoDe: Number(riego[0]),
    riegoApagarDesde: Number(riego[1]),
    ventiladorEncenderDesde: Number(cooler[0]),
    ventiladorApagarDebajoDe: Number(cooler[1]),
    luzHorario: luz ? { desde: String(luz[0]), hasta: String(luz[1]) } : null,
    riegoPulsoSegundos: pulso ? Number(pulso[0]) : PULSO_POR_DEFECTO.riegoPulsoSegundos,
    riegoEsperaLecturas: pulso ? Number(pulso[1]) : PULSO_POR_DEFECTO.riegoEsperaLecturas,
  }
  const problema = validarUmbrales(umbrales)
  if (problema) return problema
  return { v: typeof j.v === 'number' ? j.v : 0, modo: j.modo, umbrales, tz: typeof j.tz === 'string' ? j.tz : '<-03>3' }
}

/** Minutos desde la medianoche en la zona POSIX que manda el servicio ("<-03>3" = UTC-3). */
export function minutoEnZona(instante: number, tz: string): number {
  const partes = /^<([+-])(\d{2})(\d{2})?>/.exec(tz)
  const desfasaje = partes ? (partes[1] === '-' ? -1 : 1) * (Number(partes[2]) * 60 + Number(partes[3] ?? 0)) : 0
  const minutos = Math.floor(instante / 60_000) + desfasaje
  return ((minutos % 1440) + 1440) % 1440
}

export type Salida = {
  /** Cambió un actuador: publicar su `/estado`. */
  estado: (actuador: Actuador, prendido: boolean) => void
  /** Publicar `config/aplicada`. */
  aplicada: (json: string) => void
  log: (mensaje: string) => void
}

export function crearBancal(salida: Salida, config: Configuracion = CONFIG_POR_DEFECTO) {
  const actuadores: Actuadores = { luz: false, cooler: false, riego: false }
  let quiereAgua = false
  let pulso = { regando: false, inicio: 0, espera: 0 }
  let servicioEnLinea = false
  let lecturas: Sensores | null = null
  let efectivoAnterior: Modo = 'automatico'

  const efectivo = (): Modo => (servicioEnLinea ? config.modo : 'automatico')
  const poner = (a: Actuador, prendido: boolean, motivo: string) => {
    if (actuadores[a] === prendido) return
    actuadores[a] = prendido
    salida.log(`Regla: ${a} -> ${prendido ? 1 : 0} (${motivo})`)
    salida.estado(a, prendido)
  }
  const publicarAplicada = () => salida.aplicada(JSON.stringify({ v: config.v, modo: config.modo, efectivo: efectivo() }))

  function empezarPulso(ahora: number, motivo: string) {
    pulso = { regando: true, inicio: ahora, espera: 0 }
    salida.log(`Riego: pulso de ${config.umbrales.riegoPulsoSegundos} s (${motivo})`)
    poner('riego', true, motivo)
  }
  function cortarPulso(motivo: string) {
    if (!pulso.regando) return
    pulso = { regando: false, inicio: 0, espera: config.umbrales.riegoEsperaLecturas }
    poner('riego', false, motivo)
  }

  function aplicarReglas(ahora: number, motivo: string) {
    if (!lecturas) return
    const minuto = minutoEnZona(ahora, config.tz)
    const u = config.umbrales
    const riego = decidir('humedad_suelo', lecturas.humedadSuelo, () => quiereAgua, u, minuto)
    if (riego) quiereAgua = riego.encendido
    if (!quiereAgua && pulso.regando) cortarPulso('llegó a la humedad buscada')
    else if (quiereAgua && !pulso.regando && pulso.espera === 0) empezarPulso(ahora, motivo)
    const cooler = decidir('temperatura_aire', lecturas.temperaturaAire, () => actuadores.cooler, u, minuto)
    if (cooler) poner('cooler', cooler.encendido, motivo)
    const luz = decidir('luz', lecturas.luz, () => actuadores.luz, u, minuto)
    if (luz) poner('luz', luz.encendido, motivo)
  }

  function revisarModo(ahora: number) {
    const e = efectivo()
    if (e === efectivoAnterior) return
    salida.log(e === 'automatico' && config.modo === 'manual' ? 'Sin servicio: el bancal pasa a automático hasta que vuelva' : `Modo efectivo: ${e}`)
    efectivoAnterior = e
    publicarAplicada()
    if (e === 'automatico') aplicarReglas(ahora, 'pasa a automático')
  }

  return {
    actuadores,
    configuracion: () => config,

    /** Lecturas nuevas (cada INTERVALO_MS). */
    alLeer(s: Sensores, ahora: number) {
      lecturas = s
      if (!pulso.regando && pulso.espera > 0) pulso.espera--
      if (efectivo() === 'automatico') aplicarReglas(ahora, 'lectura')
    },

    /** Se llama seguido: corta el pulso de riego por tiempo, en cualquier modo. */
    alPasarElTiempo(ahora: number) {
      if (pulso.regando && ahora - pulso.inicio >= config.umbrales.riegoPulsoSegundos * 1000) {
        cortarPulso('terminó el pulso')
      }
    },

    alConfig(texto: string, ahora: number): Configuracion | null {
      const nueva = interpretarConfig(texto)
      if (typeof nueva === 'string') {
        salida.log(`Configuración rechazada: ${nueva}`)
        return null
      }
      config = nueva
      salida.log(`Configuración v${config.v}: modo ${config.modo}, riego ${config.umbrales.riegoEncenderDebajoDe}/${config.umbrales.riegoApagarDesde} %, cooler ${config.umbrales.ventiladorEncenderDesde}/${config.umbrales.ventiladorApagarDebajoDe} °C`)
      publicarAplicada()
      revisarModo(ahora)
      if (efectivo() === 'automatico') aplicarReglas(ahora, 'configuración nueva')
      return config
    },

    /** `servicio/conexion`, o `false` al perder el broker. */
    alServicio(enLinea: boolean, ahora: number) {
      servicioEnLinea = enLinea
      revisarModo(ahora)
    },

    alOrden(actuador: string, valor: string, ahora: number) {
      if (efectivo() !== 'manual') return salida.log(`Orden ignorada (${actuador} -> ${valor}): el bancal está en automático`)
      if (valor !== '1' && valor !== '0') return
      if (actuador === 'riego') {
        if (valor === '1') {
          if (!pulso.regando && pulso.espera === 0) empezarPulso(ahora, 'orden manual')
          else {
            salida.log('Riego: orden ignorada, esperando que el agua llegue al sensor')
            salida.estado('riego', pulso.regando)
          }
        } else cortarPulso('orden manual')
        return
      }
      if (actuador === 'luz' || actuador === 'cooler') poner(actuador, valor === '1', 'orden manual')
    },

    /** Al (re)conectar: todos los estados y la configuración en uso. */
    alConectar() {
      for (const a of ['luz', 'cooler', 'riego'] as const) salida.estado(a, actuadores[a])
      publicarAplicada()
    },
  }
}
