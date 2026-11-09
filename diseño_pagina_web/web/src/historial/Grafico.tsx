import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { alinear, dia, fechaHora, hora, HORA, MINUTO, medianoches, noches, sensor, type Historial, type TipoSensor } from './datos'

/** Un gráfico: uno o varios sensores que comparten unidad (y por lo tanto un solo eje Y). */
export type Panel = {
  id: string
  titulo: string
  sensores: TipoSensor[]
  /** Rango fijo del eje Y; sin esto, se ajusta a los datos. */
  rangoY?: [number, number]
  /** Líneas de referencia (los umbrales de las reglas). */
  referencias?: { valor: number; texto: string }[]
  /** Escalones en vez de líneas (la luz es 0 o 1). */
  escalon?: boolean
  /** Sombrear los tramos sin luz detrás de las líneas. */
  conNoches?: boolean
  formatoY?: (valor: number) => string
}

type Props = {
  panel: Panel
  historial: Historial
  alto: number
}

// Los colores salen de las variables CSS de historial.css: el canvas no entiende var(--...)
const css = (elemento: Element, nombre: string) => getComputedStyle(elemento).getPropertyValue(nombre).trim()

/**
 * Un gráfico tiempo/magnitud con uPlot. Todos los gráficos del dashboard comparten el cursor (la línea
 * vertical se mueve junta en los dos), y el cartel muestra el valor de cada sensor a esa hora.
 */
export function Grafico({ panel, historial, alto }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const cartel = useRef<HTMLDivElement>(null)
  const grafico = useRef<uPlot | null>(null)

  useEffect(() => {
    const div = contenedor.current
    const tip = cartel.current
    if (!div || !tip) return

    const datos = alinear(historial.series, panel.sensores)
    const xs = datos[0] as number[]
    const tramosNoche = panel.conNoches ? noches(historial.series.luz) : []
    const colores = {
      tinta: css(div, '--tinta-tenue'),
      grilla: css(div, '--grilla'),
      noche: css(div, '--noche'),
      referencia: css(div, '--referencia'),
      superficie: css(div, '--superficie'),
    }
    const rango = historial.hasta - historial.desde

    const opciones: uPlot.Options = {
      width: div.clientWidth,
      height: alto,
      padding: [8, 8, 0, 0],
      legend: { show: false },
      cursor: {
        // Solo la línea vertical: la horizontal no significa nada en el otro gráfico sincronizado
        y: false,
        sync: { key: 'historial' },
        drag: { x: false, y: false },
        points: { size: 8, width: 2, stroke: () => colores.superficie },
      },
      scales: {
        x: { time: true, range: () => [historial.desde / 1000, historial.hasta / 1000] },
        y: {
          range: (_u, min, max) => {
            if (panel.rangoY) return panel.rangoY
            if (min == null || max == null) return [0, 1]
            // Un poco de aire arriba y abajo, y nunca menos de 4 unidades de alto
            const centro = (min + max) / 2
            const medio = Math.max((max - min) / 2 + 1, 2)
            return [Math.floor(centro - medio), Math.ceil(centro + medio)]
          },
        },
      },
      axes: [
        {
          stroke: colores.tinta,
          grid: { stroke: colores.grilla, width: 1 },
          ticks: { show: false },
          space: 64,
          font: '12px system-ui, sans-serif',
          // Rangos de días: una marca por medianoche (cada 2 días si no entran), así no se repite la fecha
          splits:
            rango > 2 * 24 * HORA
              ? (u, _eje, min, max) => {
                  const dias = (max - min) / 86_400
                  return medianoches(min * 1000, max * 1000, u.bbox.width / devicePixelRatio / dias < 72 ? 2 : 1).map((ms) => ms / 1000)
                }
              : undefined,
          values: (_u, marcas) =>
            marcas.map((s) => {
              // Rangos largos: el día. Rangos cortos: la hora, y el día justo a medianoche.
              const fecha = new Date(s * 1000)
              const medianoche = fecha.getHours() === 0 && fecha.getMinutes() === 0
              return rango > 2 * 24 * HORA || medianoche ? dia(s * 1000) : hora(s * 1000)
            }),
        },
        {
          stroke: colores.tinta,
          grid: { stroke: colores.grilla, width: 1 },
          ticks: { show: false },
          size: 48,
          font: '12px system-ui, sans-serif',
          splits: panel.escalon ? () => [0, 1] : undefined,
          values: (_u, marcas) => marcas.map((v) => (panel.formatoY ? panel.formatoY(v) : String(v))),
        },
      ],
      series: [
        {},
        ...panel.sensores.map((id) => ({
          label: sensor(id).nombre,
          stroke: css(div, sensor(id).variable),
          width: 2,
          points: { show: false },
          paths: panel.escalon ? uPlot.paths.stepped!({ align: 1 }) : undefined,
        })),
      ],
      hooks: {
        // Debajo de la grilla y las líneas: la noche sombreada
        drawClear: [
          (u) => {
            const { ctx, bbox } = u
            ctx.save()
            ctx.fillStyle = colores.noche
            for (const [desde, hasta] of tramosNoche) {
              const x0 = Math.max(u.valToPos(desde / 1000, 'x', true), bbox.left)
              const x1 = Math.min(u.valToPos(hasta / 1000, 'x', true), bbox.left + bbox.width)
              if (x1 > x0) ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height)
            }
            ctx.restore()
          },
        ],
        // Arriba de todo: los umbrales de las reglas, con su texto
        draw: [
          (u) => {
            if (!panel.referencias?.length) return
            const { ctx, bbox } = u
            const escala = devicePixelRatio
            ctx.save()
            ctx.strokeStyle = colores.referencia
            ctx.fillStyle = colores.tinta
            ctx.lineWidth = escala
            ctx.font = `${12 * escala}px system-ui, sans-serif`
            ctx.textAlign = 'right'
            ctx.textBaseline = 'bottom'
            for (const { valor, texto } of panel.referencias) {
              const y = Math.round(u.valToPos(valor, 'y', true)) + 0.5
              if (y < bbox.top || y > bbox.top + bbox.height) continue
              ctx.beginPath()
              ctx.moveTo(bbox.left, y)
              ctx.lineTo(bbox.left + bbox.width, y)
              ctx.stroke()
              ctx.fillText(texto, bbox.left + bbox.width - 4 * escala, y - 3 * escala)
            }
            ctx.restore()
          },
        ],
        setCursor: [(u) => mostrarCartel(u, tip, panel, xs)],
      },
    }

    const u = new uPlot(opciones, datos as uPlot.AlignedData, div)
    grafico.current = u
    const observador = new ResizeObserver(() => u.setSize({ width: div.clientWidth, height: alto }))
    observador.observe(div)
    return () => {
      observador.disconnect()
      u.destroy()
      grafico.current = null
    }
  }, [panel, historial, alto])

  return (
    <div className="grafico" ref={contenedor}>
      <div className="grafico-cartel" ref={cartel} hidden />
    </div>
  )
}

/**
 * El cartel del cursor: la hora y el valor de cada sensor del gráfico. Como los sensores no siempre
 * tienen lectura en la misma tanda, busca la más cercana dentro de 6 minutos. Todo con textContent:
 * los nombres vienen de datos.
 */
function mostrarCartel(u: uPlot, tip: HTMLDivElement, panel: Panel, xs: number[]) {
  const i = u.cursor.idx
  const left = u.cursor.left ?? -1
  if (i == null || left < 0) {
    tip.hidden = true
    return
  }
  const x = xs[i]
  const filas = panel.sensores.map((id, s) => {
    const ys = u.data[s + 1]
    let mejor: number | null = null
    for (let d = 0; d <= 3 && mejor === null; d++) {
      for (const k of [i - d, i + d]) {
        const v = ys[k]
        if (v != null && Math.abs(xs[k] - x) * 1000 <= 6 * MINUTO) {
          mejor = v
          break
        }
      }
    }
    return { id, valor: mejor }
  })

  tip.replaceChildren()
  const titulo = document.createElement('div')
  titulo.className = 'grafico-cartel-hora'
  titulo.textContent = fechaHora(x * 1000)
  tip.append(titulo)
  for (const { id, valor } of filas) {
    const s = sensor(id)
    const fila = document.createElement('div')
    fila.className = 'grafico-cartel-fila'
    const clave = document.createElement('span')
    clave.className = 'grafico-clave'
    clave.style.setProperty('--color', `var(${s.variable})`)
    const numero = document.createElement('strong')
    numero.textContent = valor == null ? '—' : s.formato(valor)
    const nombre = document.createElement('span')
    nombre.textContent = s.nombre
    fila.append(clave, numero, nombre)
    tip.append(fila)
  }

  tip.hidden = false
  // Al lado del cursor; si no entra a la derecha, a la izquierda
  const ancho = tip.offsetWidth
  const derecha = u.over.offsetLeft + left + 14
  tip.style.left = `${derecha + ancho > u.root.clientWidth ? u.over.offsetLeft + left - ancho - 14 : derecha}px`
  tip.style.top = `${u.over.offsetTop + 4}px`
}
