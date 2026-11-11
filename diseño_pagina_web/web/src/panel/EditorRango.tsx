import { type ChangeEvent, useId, useState } from 'react'
import {
  LIMITES_COOLER,
  LIMITES_ESPERA,
  LIMITES_PULSO,
  LIMITES_RIEGO,
  MARGEN_COOLER,
  MARGEN_RIEGO,
  validarUmbrales,
  type Umbrales,
} from '../../../../software/servicio/src/reglas.ts'
import type { Actuador } from '../estado'

type Props = {
  actuador: Actuador
  /** Los rangos que usa hoy el bancal (propios o por defecto). */
  umbrales: Umbrales
  enviando: boolean
  alGuardar: (nuevos: Umbrales) => void
  alCancelar: () => void
}

/**
 * Editor del rango de un actuador, dentro del panel de actuadores. Valida con la misma función que el
 * servicio (software/servicio/src/reglas.ts), así lo que se puede guardar acá es lo mismo que acepta él.
 */
export function EditorRango({ actuador, umbrales, enviando, alGuardar, alCancelar }: Props) {
  const [borrador, setBorrador] = useState<Umbrales>(umbrales)
  const id = useId()
  const problema = validarUmbrales(borrador)
  const sinCambios = JSON.stringify(borrador) === JSON.stringify(umbrales)
  const numero = (clave: keyof Umbrales) => (e: ChangeEvent<HTMLInputElement>) =>
    setBorrador((b) => ({ ...b, [clave]: e.target.value === '' ? Number.NaN : Number(e.target.value) }))

  return (
    <form
      className="rango"
      onSubmit={(e) => {
        e.preventDefault()
        if (!problema && !sinCambios) alGuardar(borrador)
      }}
    >
      {actuador === 'riego' && (
        <>
          <div className="rango-campos">
            <Campo id={`${id}-prende`} etiqueta="Prende bajo" unidad="%" valor={borrador.riegoEncenderDebajoDe} limites={LIMITES_RIEGO} paso={1} alCambiar={numero('riegoEncenderDebajoDe')} />
            <Campo id={`${id}-apaga`} etiqueta="Apaga desde" unidad="%" valor={borrador.riegoApagarDesde} limites={LIMITES_RIEGO} paso={1} alCambiar={numero('riegoApagarDesde')} />
          </div>
          <Banda
            limites={LIMITES_RIEGO}
            prende={[LIMITES_RIEGO[0], borrador.riegoEncenderDebajoDe]}
            apaga={[borrador.riegoApagarDesde, LIMITES_RIEGO[1]]}
            unidad="%"
          />
          <p className="rango-ayuda">Entre los dos sigue como estaba. Al menos {MARGEN_RIEGO} puntos de diferencia.</p>
          <div className="rango-campos rango-pulso">
            <Campo id={`${id}-pulso`} etiqueta="Riega de a" unidad="s" valor={borrador.riegoPulsoSegundos} limites={LIMITES_PULSO} paso={1} alCambiar={numero('riegoPulsoSegundos')} />
            <Campo id={`${id}-espera`} etiqueta="Y espera" unidad="lecturas" valor={borrador.riegoEsperaLecturas} limites={LIMITES_ESPERA} paso={1} alCambiar={numero('riegoEsperaLecturas')} />
          </div>
          <p className="rango-ayuda">
            Riega por pulsos, en automático y en manual: la bomba prende {borrador.riegoPulsoSegundos || '?'} s y después espera{' '}
            {borrador.riegoEsperaLecturas || '?'} lecturas (unos {(borrador.riegoEsperaLecturas || 0) * 5} s) para que el agua llegue al sensor.
          </p>
        </>
      )}

      {actuador === 'cooler' && (
        <>
          <div className="rango-campos">
            <Campo id={`${id}-prende`} etiqueta="Prende desde" unidad="°C" valor={borrador.ventiladorEncenderDesde} limites={LIMITES_COOLER} paso={0.5} alCambiar={numero('ventiladorEncenderDesde')} />
            <Campo id={`${id}-apaga`} etiqueta="Apaga bajo" unidad="°C" valor={borrador.ventiladorApagarDebajoDe} limites={LIMITES_COOLER} paso={0.5} alCambiar={numero('ventiladorApagarDebajoDe')} />
          </div>
          <Banda
            limites={LIMITES_COOLER}
            prende={[borrador.ventiladorEncenderDesde, LIMITES_COOLER[1]]}
            apaga={[LIMITES_COOLER[0], borrador.ventiladorApagarDebajoDe]}
            unidad="°C"
          />
          <p className="rango-ayuda">Entre los dos sigue como estaba. Al menos {MARGEN_COOLER} °C de diferencia.</p>
        </>
      )}

      {actuador === 'luz' && (
        <>
          <label className="rango-check">
            <input
              type="checkbox"
              checked={borrador.luzHorario !== null}
              onChange={(e) => setBorrador((b) => ({ ...b, luzHorario: e.target.checked ? { desde: '18:00', hasta: '23:00' } : null }))}
            />
            Solo en un horario
          </label>
          {borrador.luzHorario !== null ? (
            <div className="rango-campos">
              <label className="rango-campo" htmlFor={`${id}-desde`}>
                <span>Desde</span>
                <input
                  id={`${id}-desde`}
                  type="time"
                  value={borrador.luzHorario.desde}
                  onChange={(e) => setBorrador((b) => ({ ...b, luzHorario: { ...b.luzHorario!, desde: e.target.value } }))}
                />
              </label>
              <label className="rango-campo" htmlFor={`${id}-hasta`}>
                <span>Hasta</span>
                <input
                  id={`${id}-hasta`}
                  type="time"
                  value={borrador.luzHorario.hasta}
                  onChange={(e) => setBorrador((b) => ({ ...b, luzHorario: { ...b.luzHorario!, hasta: e.target.value } }))}
                />
              </label>
            </div>
          ) : null}
          <p className="rango-ayuda">
            {borrador.luzHorario
              ? 'A oscuras prende solo dentro del horario; fuera de él queda apagada. Puede cruzar la medianoche.'
              : 'Sin horario: prende siempre que esté oscuro.'}
          </p>
        </>
      )}

      {problema && (
        <p className="rango-problema" role="alert">
          {problema}
        </p>
      )}
      <div className="rango-botones">
        <button type="button" className="rango-boton" onClick={alCancelar}>
          Cancelar
        </button>
        <button type="submit" className="rango-boton" data-principal disabled={enviando || problema !== null || sinCambios}>
          Guardar
        </button>
      </div>
    </form>
  )
}

function Campo(props: {
  id: string
  etiqueta: string
  unidad: string
  valor: number
  limites: [number, number]
  paso: number
  alCambiar: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="rango-campo" htmlFor={props.id}>
      <span>{props.etiqueta}</span>
      <span className="rango-numero">
        <input
          id={props.id}
          type="number"
          inputMode="decimal"
          min={props.limites[0]}
          max={props.limites[1]}
          step={props.paso}
          value={Number.isNaN(props.valor) ? '' : props.valor}
          onChange={props.alCambiar}
        />
        {props.unidad}
      </span>
    </label>
  )
}

/** Barra de 0 a 100 % (o de 0 a 50 °C) con dónde prende, dónde apaga y la banda del medio. */
function Banda({ limites, prende, apaga, unidad }: { limites: [number, number]; prende: [number, number]; apaga: [number, number]; unidad: string }) {
  const [min, max] = limites
  const pos = (v: number) => `${((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100}%`
  const ancho = ([a, b]: [number, number]) => `calc(${pos(b)} - ${pos(a)})`
  const valido = [...prende, ...apaga].every(Number.isFinite)
  return (
    <div className="banda" aria-hidden>
      {valido && (
        <>
          <span className="banda-prende" style={{ left: pos(prende[0]), width: ancho(prende) }} />
          <span className="banda-apaga" style={{ left: pos(apaga[0]), width: ancho(apaga) }} />
        </>
      )}
      <span className="banda-extremo">
        {min} {unidad}
      </span>
      <span className="banda-extremo" data-fin>
        {max} {unidad}
      </span>
    </div>
  )
}
