import { useProgress } from '@react-three/drei'
import './cargando.css'

/**
 * Pantalla de carga mientras baja home.glb. Se desvanece sola al terminar
 * (queda montada pero invisible y sin capturar clics).
 *
 * La barra es "indeterminada" (un tramo que va y viene): Three.js cuenta el avance
 * por archivo y el modelo es uno solo, así que el porcentaje saltaría de 0 a 100.
 */
export function Cargando() {
  const { active, progress } = useProgress()
  const listo = !active && progress === 100

  return (
    <div className="cargando" data-listo={listo} role="status" aria-live="polite">
      <div className="cargando-caja">
        <span className="cargando-texto">{listo ? 'Listo' : 'Preparando la escena…'}</span>
        <div className="cargando-barra" role="progressbar" aria-label="Carga de la escena">
          <div className="cargando-relleno" />
        </div>
      </div>
    </div>
  )
}
