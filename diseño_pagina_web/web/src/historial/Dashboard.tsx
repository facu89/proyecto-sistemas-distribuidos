import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import type { Instantanea } from '../bancal'
import { IconoFlecha } from '../panel/iconos'
import { HORA, pedirHistorial, SENSORES, sensor, type Historial, type TipoSensor } from './datos'
import { Grafico, type Panel } from './Grafico'
import './historial.css'
import { Tablas } from './Tablas'

type Props = {
  abierto: boolean
  /** Lo llama el botón de cerrar, Escape o el "atrás" del navegador. */
  alCerrar: () => void
  nodoId: string
  umbrales: Instantanea['umbrales'] | null
}

const RANGOS = [
  { id: '24h', nombre: '24 h', ms: 24 * HORA },
  { id: '7d', nombre: '7 días', ms: 7 * 24 * HORA },
  { id: '14d', nombre: '14 días', ms: 14 * 24 * HORA },
] as const
type Rango = (typeof RANGOS)[number]['id']

/** Se guarda una lectura cada 10 minutos: con refrescar cada 5 alcanza para no perder ninguna. */
const REFRESCO_MS = 5 * 60_000

/**
 * Historial de los sensores (lo que EMQX guarda en MySQL). Es una hoja que sube y ocupa toda la
 * pantalla: arriba los gráficos tiempo/magnitud y, bajando, las tablas de cada sensor.
 *
 * Gráficos: nunca dos ejes Y en el mismo gráfico (se leen mal). Con "Todos" van dos gráficos con el
 * mismo eje de tiempo y el cursor sincronizado: temperaturas (°C) y humedades (%). La luz no es una
 * línea: sombrea de fondo los tramos de noche. Con un solo sensor, su gráfico y los umbrales de la regla.
 */
export function Dashboard({ abierto, alCerrar, nodoId, umbrales }: Props) {
  const [seleccion, setSeleccion] = useState<TipoSensor | null>(null)
  const [rango, setRango] = useState<Rango>('24h')
  const [datos, setDatos] = useState<Historial | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargado, setCargado] = useState<string | null>(null)
  const [refresco, setRefresco] = useState(0)
  const altoVentana = useAltoVentana()
  const botonCerrar = useRef<HTMLButtonElement>(null)
  const tablas = useRef<HTMLDivElement>(null)

  // Mientras está abierto: refresca cada tanto, se cierra con Escape y el foco va al botón de cerrar
  useEffect(() => {
    if (!abierto) return
    botonCerrar.current?.focus({ preventScroll: true })
    const intervalo = setInterval(() => setRefresco((r) => r + 1), REFRESCO_MS)
    const alPresionar = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar()
    window.addEventListener('keydown', alPresionar)
    return () => {
      clearInterval(intervalo)
      window.removeEventListener('keydown', alPresionar)
    }
  }, [abierto, alCerrar])

  // Datos de los gráficos: todos los sensores del rango elegido (la luz hace falta para la noche)
  const pedido = `${nodoId}|${rango}|${refresco}`
  const cargando = abierto && cargado !== pedido
  useEffect(() => {
    if (!abierto) return
    const control = new AbortController()
    const hasta = Date.now()
    const ms = RANGOS.find((r) => r.id === rango)!.ms
    pedirHistorial(nodoId, hasta - ms, hasta, null, control.signal)
      .then((h) => {
        setDatos(h)
        setError(null)
      })
      .catch((e: unknown) => !control.signal.aborted && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !control.signal.aborted && setCargado(pedido))
    return () => control.abort()
  }, [abierto, nodoId, rango, refresco, pedido])

  const paneles = useMemo(() => armarPaneles(seleccion, umbrales), [seleccion, umbrales])
  // Con "Todos" los dos gráficos se reparten la pantalla; con uno solo, ocupa más
  const alto = Math.round(
    paneles.length > 1
      ? Math.min(Math.max((altoVentana - 300) / 2, 170), 320)
      : Math.min(Math.max(altoVentana - 330, 240), 480),
  )
  const sinDatos = datos !== null && Object.keys(datos.series).length === 0

  return (
    <div className="historial" data-abierto={abierto} inert={!abierto} role="dialog" aria-modal="true" aria-labelledby="historial-titulo">
      <header className="historial-cabecera">
        <button ref={botonCerrar} type="button" className="historial-cerrar" aria-label="Cerrar historial" onClick={alCerrar}>
          <IconoFlecha hacia="abajo" />
        </button>
        <div>
          <h2 id="historial-titulo">Historial</h2>
          <p>{nodoId} · una lectura cada 10 minutos, hasta 14 días</p>
        </div>
      </header>

      <div className="historial-filtros">
        <div className="historial-chips" role="group" aria-label="Sensor">
          <button type="button" className="chip" aria-pressed={seleccion === null} onClick={() => setSeleccion(null)}>
            Todos
          </button>
          {SENSORES.map((s) => (
            <button key={s.id} type="button" className="chip" aria-pressed={seleccion === s.id} onClick={() => setSeleccion(s.id)}>
              <span className="grafico-clave" style={{ '--color': `var(${s.variable})` } as CSSProperties} />
              {s.corto}
            </button>
          ))}
        </div>
        <div className="historial-rangos" role="group" aria-label="Período">
          {RANGOS.map((r) => (
            <button key={r.id} type="button" className="modo-opcion" aria-pressed={rango === r.id} onClick={() => setRango(r.id)}>
              {r.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="historial-cuerpo">
        <section className="historial-graficos" data-cargando={cargando} aria-label="Gráficos">
          {error && (
            <p className="historial-error" role="alert">
              {error}
            </p>
          )}
          {sinDatos && <p className="historial-vacio">Todavía no hay lecturas guardadas en este período.</p>}
          {/* key: al cambiar de sensor los gráficos se montan de nuevo y entran con la animación */}
          <div className="historial-paneles" key={seleccion ?? 'todos'}>
            {datos &&
              !sinDatos &&
              paneles.map((panel) => (
                <figure key={panel.id} className="panel-grafico">
                  <figcaption>
                    <span className="panel-grafico-titulo">{panel.titulo}</span>
                    {(panel.sensores.length > 1 || panel.conNoches) && (
                      <span className="leyenda">
                        {/* Un solo sensor no lleva leyenda: el título ya dice qué es */}
                        {panel.sensores.length > 1 &&
                          panel.sensores.map((id) => (
                          <span key={id} className="leyenda-item">
                            <span className="grafico-clave" style={{ '--color': `var(${sensor(id).variable})` } as CSSProperties} />
                            {sensor(id).nombre}
                          </span>
                          ))}
                        {panel.conNoches && (
                          <span className="leyenda-item">
                            <span className="leyenda-noche" />
                            Noche (sin luz)
                          </span>
                        )}
                      </span>
                    )}
                  </figcaption>
                  <Grafico panel={panel} historial={datos} alto={alto} />
                </figure>
              ))}
          </div>
          <button type="button" className="historial-a-tablas" onClick={() => tablas.current?.scrollIntoView({ behavior: 'smooth' })}>
            Ver las tablas
            <IconoFlecha hacia="abajo" />
          </button>
        </section>

        <div ref={tablas} className="historial-tablas">
          {abierto && <Tablas nodoId={nodoId} seleccion={seleccion} refresco={refresco} />}
        </div>
      </div>
    </div>
  )
}

function armarPaneles(seleccion: TipoSensor | null, u: Instantanea['umbrales'] | null): Panel[] {
  if (seleccion === null) {
    return [
      { id: 'temperatura', titulo: 'Temperatura (°C)', sensores: ['temperatura_suelo', 'temperatura_aire'], conNoches: true },
      { id: 'humedad', titulo: 'Humedad (%)', sensores: ['humedad_aire', 'humedad_suelo'], rangoY: [0, 100], conNoches: true },
    ]
  }
  const s = sensor(seleccion)
  if (s.grupo === 'luz') {
    return [{ id: 'luz', titulo: 'Luz', sensores: ['luz'], rangoY: [0, 1], escalon: true, formatoY: (v) => (v >= 0.5 ? 'Luz' : 'Oscuro') }]
  }
  const referencias =
    seleccion === 'humedad_suelo' && u
      ? [
          { valor: u.riegoApagarDesde, texto: `Riego: para desde ${u.riegoApagarDesde} %` },
          { valor: u.riegoEncenderDebajoDe, texto: `Riego: prende bajo ${u.riegoEncenderDebajoDe} %` },
        ]
      : seleccion === 'temperatura_aire' && u
        ? [
            { valor: u.ventiladorEncenderDesde, texto: `Cooler: prende desde ${u.ventiladorEncenderDesde} °C` },
            { valor: u.ventiladorApagarDebajoDe, texto: `Cooler: apaga bajo ${u.ventiladorApagarDebajoDe} °C` },
          ]
        : undefined
  return [
    {
      id: seleccion,
      titulo: `${s.nombre} (${s.grupo === 'temperatura' ? '°C' : '%'})`,
      sensores: [seleccion],
      rangoY: s.grupo === 'humedad' ? [0, 100] : undefined,
      referencias,
      conNoches: true,
    },
  ]
}

function useAltoVentana() {
  const [alto, setAlto] = useState(() => window.innerHeight)
  useEffect(() => {
    const alCambiar = () => setAlto(window.innerHeight)
    window.addEventListener('resize', alCambiar)
    return () => window.removeEventListener('resize', alCambiar)
  }, [])
  return alto
}
