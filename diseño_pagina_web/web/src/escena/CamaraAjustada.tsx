import { PerspectiveCamera } from '@react-three/drei'
import { useThree } from '@react-three/fiber'

// Coordenadas de Three.js: Y hacia arriba. (Blender usa Z hacia arriba; el exportador
// glTF convierte (x, y, z) de Blender en (x, z, -y)).

/** Centro de la escena: desde el ventilador hasta la regadera y desde el piso hasta la lámpara. */
const CENTRO = { x: -0.1, y: 2.05 }
/** Lo que tiene que entrar siempre en pantalla, en metros, con algo de margen. */
const ANCHO = 6.4
const ALTO = 6.2
/** Más lejos = menos deformación de perspectiva (el campo de visión se ajusta solo). */
const DISTANCIA = 10.5

/**
 * Cámara fija, de frente como en el concepto, que ajusta el campo de visión al tamaño
 * de la ventana: en horizontal manda el alto de la escena y en vertical (celular) manda
 * el ancho, así nunca se corta ni el ventilador ni la regadera.
 */
export function CamaraAjustada() {
  const aspecto = useThree((s) => s.size.width / s.size.height)

  const fovPorAlto = 2 * Math.atan(ALTO / 2 / DISTANCIA)
  const fovPorAncho = 2 * Math.atan(ANCHO / 2 / (DISTANCIA * aspecto))
  const fov = (Math.max(fovPorAlto, fovPorAncho) * 180) / Math.PI

  return (
    <PerspectiveCamera
      makeDefault
      fov={fov}
      near={0.1}
      far={50}
      position={[CENTRO.x, CENTRO.y, DISTANCIA]}
    />
  )
}
