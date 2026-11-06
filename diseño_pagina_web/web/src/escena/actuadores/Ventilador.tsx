import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { type ComponentRef, useMemo, useRef } from 'react'
import * as THREE from 'three'

type Line2 = ComponentRef<typeof Line>

type Props = {
  scene: THREE.Object3D
  encendido: boolean
  menosMovimiento: boolean
}

/** Velocidad de giro de las aspas encendidas, en radianes por segundo (≈ 2,2 vueltas/s). */
const VELOCIDAD_MAX = 14
/** Con "reducir movimiento" gira mucho más lento y las líneas de viento no avanzan. */
const VELOCIDAD_REDUCIDA = 3
/** Arranque y frenado lentos (unos 3 s), para que el aire llegue de a poco. */
const SUAVIDAD_ARRANQUE = 0.8
const SUAVIDAD_FRENADO = 0.6

/** Hacia dónde sopla: la flor, en coordenadas de Three.js. */
const OBJETIVO = new THREE.Vector3(0, 2.05, 0)
/** Desfasaje vertical de cada línea de viento respecto del centro del ventilador. */
const LINEAS = [
  { alto: 0.2, fase: 0, largo: 1.25 },
  { alto: 0.0, fase: 1.7, largo: 1.45 },
  { alto: -0.2, fase: 3.1, largo: 1.2 },
]

/**
 * Ventilador: las aspas aceleran y frenan con suavidad, y unas líneas de viento
 * (trazos que avanzan) aparecen entre el ventilador y la planta.
 *
 * Las aspas giran sobre su Z local: en Blender es el Y local, y el exportador glTF
 * lo convierte (ver el contrato de nombres en PLAN.md).
 */
export function Ventilador({ scene, encendido, menosMovimiento }: Props) {
  const velocidad = useRef(0)
  const lineas = useRef<(Line2 | null)[]>([])

  const { aspas, curvas } = useMemo(() => {
    const aspas = scene.getObjectByName('Ventilador_Aspas')
    const ventilador = scene.getObjectByName('Ventilador')
    const centro = ventilador?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3()
    const frente = ventilador
      ? new THREE.Vector3(0, 0, 1).applyQuaternion(ventilador.getWorldQuaternion(new THREE.Quaternion()))
      : new THREE.Vector3(1, 0, 0)
    const curvas = LINEAS.map((l) => curvaDeViento(centro, frente, l.alto, l.largo, l.fase))
    return { aspas, curvas }
  }, [scene])

  useFrame((_, delta) => {
    const suavidad = encendido ? SUAVIDAD_ARRANQUE : SUAVIDAD_FRENADO
    const maxima = menosMovimiento ? VELOCIDAD_REDUCIDA : VELOCIDAD_MAX
    velocidad.current = THREE.MathUtils.damp(velocidad.current, encendido ? maxima : 0, suavidad, delta)
    const nivel = velocidad.current / maxima
    if (aspas) girar(aspas, velocidad.current * delta)
    const avance = menosMovimiento ? 0 : delta
    lineas.current.forEach((linea, i) => linea && animarLinea(linea, nivel, avance, i))
  })

  return (
    <>
      {curvas.map((puntos, i) => (
        <Line
          key={i}
          ref={(l) => {
            lineas.current[i] = l
          }}
          points={puntos}
          color="#fffaf2"
          lineWidth={2.2}
          dashed
          dashSize={0.45}
          gapSize={1.1}
          transparent
          opacity={0}
          depthWrite={false}
        />
      ))}
    </>
  )
}

function girar(aspas: THREE.Object3D, angulo: number) {
  aspas.rotation.z -= angulo
}

function animarLinea(linea: Line2, nivel: number, delta: number, i: number) {
  const material = linea.material
  material.dashOffset -= delta * (0.8 + 0.15 * i) * nivel
  // Las líneas aparecen de a poco, a medida que las aspas toman velocidad
  material.opacity = THREE.MathUtils.smoothstep(nivel, 0.2, 1) * 0.45
  linea.visible = material.opacity > 0.01
}

/** Curva ondulada que sale del frente del ventilador y va hacia la planta. */
function curvaDeViento(
  centro: THREE.Vector3,
  frente: THREE.Vector3,
  alto: number,
  largo: number,
  fase: number,
) {
  const inicio = centro.clone().addScaledVector(frente, 0.22).add(new THREE.Vector3(0, alto, 0))
  const fin = OBJETIVO.clone().add(new THREE.Vector3(-0.45, alto * 1.4, 0.15))
  const direccion = fin.clone().sub(inicio).normalize()
  const puntos: THREE.Vector3[] = []
  for (let k = 0; k <= 6; k++) {
    const t = k / 6
    const p = inicio.clone().addScaledVector(direccion, t * largo)
    p.y += Math.sin(t * Math.PI * 2 + fase) * 0.05 * t
    puntos.push(p)
  }
  return new THREE.CatmullRomCurve3(puntos).getPoints(48)
}
