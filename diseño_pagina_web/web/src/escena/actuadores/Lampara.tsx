import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

type Props = {
  scene: THREE.Object3D
  materiales: Record<string, THREE.Material>
  encendida: boolean
}

const COLOR_VIDRIO = new THREE.Color('#ffd9a3')
const COLOR_FILAMENTO = new THREE.Color('#ffb25e')
const COLOR_LUZ = '#ffc98a'

/** Valores con la lámpara encendida del todo. */
const MAX = {
  vidrio: 1.4, // emissiveIntensity
  filamento: 8,
  luz: 22, // candelas de la luz puntual (el estudio se atenúa, ver Iluminacion.tsx)
  halo: 0.55, // opacidad del resplandor
}
/** Velocidad de la transición (más alto = más rápido). Prender es más rápido que apagar. */
const SUAVIDAD_PRENDER = 9
const SUAVIDAD_APAGAR = 5

/**
 * Lámpara: el vidrio y el filamento brillan (emissive), se enciende una luz puntual
 * dentro de la lámpara que ilumina de verdad la planta, y un halo suave detrás
 * imita el resplandor (sin el costo de un efecto de post-procesado).
 */
export function Lampara({ scene, materiales, encendida }: Props) {
  const luz = useRef<THREE.PointLight>(null)
  const halo = useRef<THREE.Sprite>(null)
  const nivel = useRef(0)

  const posicion = useMemo(
    () => scene.getObjectByName('Lampara')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(),
    [scene],
  )
  const texturaHalo = useMemo(() => crearTexturaHalo(), [])

  useFrame((_, delta) => {
    const suavidad = encendida ? SUAVIDAD_PRENDER : SUAVIDAD_APAGAR
    nivel.current = THREE.MathUtils.damp(nivel.current, encendida ? 1 : 0, suavidad, delta)
    aplicarNivel(nivel.current, materiales, luz.current, halo.current)
  })

  return (
    <group position={posicion}>
      <pointLight ref={luz} color={COLOR_LUZ} intensity={0} decay={2} position={[0, -0.05, 0]} />
      <sprite ref={halo} scale={2.4} renderOrder={-1}>
        <spriteMaterial
          map={texturaHalo}
          color={COLOR_LUZ}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </group>
  )
}

function aplicarNivel(
  n: number,
  materiales: Record<string, THREE.Material>,
  luz: THREE.PointLight | null,
  halo: THREE.Sprite | null,
) {
  const vidrio = materiales.Vidrio as THREE.MeshStandardMaterial
  const filamento = materiales.Filamento as THREE.MeshStandardMaterial
  vidrio.emissive.copy(COLOR_VIDRIO)
  vidrio.emissiveIntensity = n * MAX.vidrio
  vidrio.opacity = 0.72 + n * 0.23 // encendido se ve más "lleno" de luz
  filamento.emissive.copy(COLOR_FILAMENTO)
  filamento.emissiveIntensity = n * MAX.filamento
  if (luz) luz.intensity = n * MAX.luz
  if (halo) (halo.material as THREE.SpriteMaterial).opacity = n * MAX.halo
}

/** Degradé radial blanco → transparente para el halo. */
function crearTexturaHalo() {
  const lado = 128
  const lienzo = document.createElement('canvas')
  lienzo.width = lienzo.height = lado
  const ctx = lienzo.getContext('2d')!
  const g = ctx.createRadialGradient(lado / 2, lado / 2, 0, lado / 2, lado / 2, lado / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, lado, lado)
  const textura = new THREE.CanvasTexture(lienzo)
  textura.colorSpace = THREE.SRGBColorSpace
  return textura
}
