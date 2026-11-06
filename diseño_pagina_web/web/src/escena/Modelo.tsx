import { useAnimations, useGLTF } from '@react-three/drei'
import { useLayoutEffect } from 'react'
import * as THREE from 'three'
import { DEPURACION } from '../depuracion'
import type { EstadoActuadores } from '../estado'
import { Lampara } from './actuadores/Lampara'
import { Planta } from './actuadores/Planta'
import { Riego } from './actuadores/Riego'
import { Ventilador } from './actuadores/Ventilador'
import { useMenosMovimiento } from './useMenosMovimiento'

type Props = { estado: EstadoActuadores }

// Todos los .glb de ../modelos, por nombre. Normalmente se usa home.glb; con
// ?modelo=<nombre> se puede cargar otro para comparar (ver depuracion.ts).
const MODELOS = import.meta.glob<string>('../../../modelos/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
})
const urlModelo = MODELOS[`../../../modelos/${DEPURACION.modelo}.glb`] ?? MODELOS['../../../modelos/home.glb']
if (DEPURACION.modelo !== 'home') console.info('[depuración] modelo:', urlModelo)

/**
 * Carga home.glb (lo genera blender/generar_escena.py) y le pasa a cada actuador
 * las piezas del modelo que anima.
 *
 * Los nombres de nodos, materiales y animaciones son el "contrato" descripto en PLAN.md.
 */
export function Modelo({ estado }: Props) {
  const { scene, animations, materials } = useGLTF(urlModelo)
  const { actions } = useAnimations(animations, scene)
  const menosMovimiento = useMenosMovimiento()

  // useLayoutEffect: corre antes de que se dibuje el primer cuadro.
  useLayoutEffect(() => prepararModelo(scene, materials), [scene, materials])

  return (
    <>
      <primitive object={scene} />
      <Planta
        brisa={actions.Planta_Brisa}
        viento={actions.Planta_Viento}
        hayViento={estado.ventilador}
        menosMovimiento={menosMovimiento}
      />
      <Lampara scene={scene} materiales={materials} encendida={estado.luz} />
      <Ventilador scene={scene} encendido={estado.ventilador} menosMovimiento={menosMovimiento} />
      <Riego
        scene={scene}
        accion={actions.Regadera_Regar}
        activo={estado.riego}
        menosMovimiento={menosMovimiento}
      />
    </>
  )
}

useGLTF.preload(urlModelo)

/** true si el objeto es parte de la lámpara o del ventilador. */
function flota(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (o.name === 'Lampara' || o.name === 'Ventilador') return true
  }
  return false
}

/** Ajustes al modelo que en Blender se ven bien pero en tiempo real no. */
function prepararModelo(scene: THREE.Object3D, materiales: Record<string, THREE.Material>) {
  // Vidrio: en Blender usa transmisión (refracción). En Three.js la transmisión solo
  // "ve" los objetos 3D, no el fondo CSS, así que la lámpara se vería oscura.
  // Se reemplaza por un vidrio esmerilado semitransparente, más barato y parecido al concepto.
  const vidrio = materiales.Vidrio as THREE.MeshPhysicalMaterial
  vidrio.transmission = 0
  vidrio.transparent = true
  vidrio.opacity = 0.72
  vidrio.roughness = 0.25
  vidrio.depthWrite = false

  // La planta tiene esqueleto: al animarse puede salirse de su caja original
  // y Three.js la ocultaría por error en algunos cuadros.
  scene.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) obj.frustumCulled = false
    // Proyectan sombra sobre el piso la maceta, la planta y la regadera. La lámpara y
    // el ventilador flotan: una sombra suya en el piso confundiría.
    if ((obj as THREE.Mesh).isMesh) obj.castShadow = DEPURACION.sombras && !flota(obj)
  })
}
