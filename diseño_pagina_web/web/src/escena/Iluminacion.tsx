import { Environment, Lightformer } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { DEPURACION } from '../depuracion'

type Props = {
  /** Con la lámpara encendida el estudio se atenúa, como al caer la tarde. */
  lamparaEncendida: boolean
}

/**
 * Intensidades con el estudio a pleno (lámpara apagada) y atenuado (lámpara encendida).
 * La sombra la proyecta la luz principal: si esa luz baja, la sombra se aclara con ella.
 */
const PLENO = { principal: 1.8, cielo: 0.35, entorno: 1, sombra: 0.32 }
const ATENUADO = { principal: 0.75, cielo: 0.15, entorno: 0.45, sombra: 0.13 }
/** Más lento que el encendido de la lámpara: como los ojos que se acostumbran. */
const SUAVIDAD = 2.5

/**
 * Luz de estudio parecida a la de Blender: una luz principal arriba a la izquierda,
 * un relleno frío a la derecha y un "softbox" grande arriba.
 *
 * El entorno se arma con Lightformers locales en vez de un HDR descargado,
 * así la página no depende de ningún archivo externo.
 */
export function Iluminacion({ lamparaEncendida }: Props) {
  const principal = useRef<THREE.DirectionalLight>(null)
  const cielo = useRef<THREE.HemisphereLight>(null)
  const sombra = useRef<THREE.ShadowMaterial>(null)
  const nivel = useRef(0) // 0 = estudio a pleno, 1 = atenuado
  const escena = useThree((s) => s.scene)

  useFrame((_, delta) => {
    nivel.current = THREE.MathUtils.damp(nivel.current, lamparaEncendida ? 1 : 0, SUAVIDAD, delta)
    atenuar(nivel.current, { principal: principal.current, cielo: cielo.current, sombra: sombra.current }, escena)
  })

  return (
    <>
      <Environment resolution={256} frames={1}>
        {/* "Paredes" del estudio: sin esto el entorno es negro entre los paneles
            y los metales (regadera, rosca) se ven oscuros. */}
        <color attach="background" args={['#9c8a77']} />
        <Lightformer form="rect" intensity={1.6} position={[0, 7, 2]} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={2.2} position={[-5, 4, 5]} scale={[4, 4, 1]} color="#fff3e2" />
        <Lightformer form="rect" intensity={0.9} position={[6, 2, 4]} scale={[4, 5, 1]} color="#e6edff" />
        <Lightformer form="rect" intensity={0.5} position={[0, 1, -6]} scale={[12, 4, 1]} />
      </Environment>

      {/* Luz principal, arriba a la izquierda y algo adelante. Es la única que proyecta
          sombras: bastante cenital, así la sombra cae bajo la maceta y no queda escondida detrás. */}
      <directionalLight
        ref={principal}
        position={[-2.5, 8, 3]}
        intensity={PLENO.principal}
        color="#fff4e6"
        castShadow={DEPURACION.sombras}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-camera-near={1}
        shadow-camera-far={20}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={6}
      />
      <hemisphereLight ref={cielo} args={['#f3eee8', '#8a7f74', PLENO.cielo]} />

      {/* Piso invisible que solo muestra las sombras (el fondo es el degradé CSS).
          Qué objetos proyectan sombra se decide en prepararModelo (Modelo.tsx). */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <shadowMaterial ref={sombra} color="#2b1d12" opacity={PLENO.sombra} transparent />
      </mesh>
    </>
  )
}

type Luces = {
  principal: THREE.DirectionalLight | null
  cielo: THREE.HemisphereLight | null
  sombra: THREE.ShadowMaterial | null
}

function atenuar(n: number, { principal, cielo, sombra }: Luces, escena: THREE.Scene) {
  const mezclar = THREE.MathUtils.lerp
  if (principal) principal.intensity = mezclar(PLENO.principal, ATENUADO.principal, n)
  if (cielo) cielo.intensity = mezclar(PLENO.cielo, ATENUADO.cielo, n)
  if (sombra) sombra.opacity = mezclar(PLENO.sombra, ATENUADO.sombra, n)
  escena.environmentIntensity = mezclar(PLENO.entorno, ATENUADO.entorno, n)
}
