import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

type Props = {
  scene: THREE.Object3D
  accion?: THREE.AnimationAction | null
  activo: boolean
  menosMovimiento: boolean
}

const MAX_GOTAS = 90
/** Gotas por segundo mientras riega. */
const TASA = 42
/** Velocidad de salida por el pico y dispersión, en m/s. */
const VELOCIDAD_SALIDA = 1.15
const DISPERSION = 0.38
/** Gravedad "de dibujo animado": más lenta que la real para que se vean las gotas. */
const GRAVEDAD = 5.5
/** Al apagar: espera a que caigan las gotas antes de bajar la regadera. */
const ESPERA_AL_APAGAR = 0.45

/** Tierra de la maceta, en coordenadas de Three.js (ver Z_TIERRA en el script de Blender). */
const ALTURA_TIERRA = 0.86
const RADIO_TIERRA = 0.53

type Gota = { viva: boolean; posicion: THREE.Vector3; velocidad: THREE.Vector3 }

/**
 * Riego: la regadera se levanta (clip `Regadera_Regar` hacia adelante) y, cuando llega
 * a la pose de riego, empiezan a caer gotas desde `Regadera_Boquilla`. Al apagar,
 * primero se cortan las gotas y después el clip vuelve hacia atrás hasta el piso.
 */
export function Riego({ scene, accion, activo, menosMovimiento }: Props) {
  const malla = useRef<THREE.InstancedMesh>(null)
  const pendientes = useRef(0) // fracción de gota acumulada entre cuadros
  const sinRiego = useRef(ESPERA_AL_APAGAR) // segundos desde que se apagó

  const boquilla = useMemo(() => scene.getObjectByName('Regadera_Boquilla'), [scene])
  const gotas = useMemo<Gota[]>(
    () =>
      Array.from({ length: MAX_GOTAS }, () => ({
        viva: false,
        posicion: new THREE.Vector3(),
        velocidad: new THREE.Vector3(),
      })),
    [],
  )

  // El clip se reproduce una sola vez y queda clavado en el extremo al que llega.
  useEffect(() => {
    if (!accion) return
    prepararAccion(accion)
    return () => {
      accion.stop()
    }
  }, [accion])

  useFrame((_, delta) => {
    if (!accion || !malla.current || !boquilla) return
    // Tope al paso: evita saltos al volver de otra pestaña, pero es lo bastante alto
    // para que en equipos lentos (pocos cuadros por segundo) las gotas no caigan en cámara lenta.
    const dt = Math.min(delta, 0.1)
    sinRiego.current = activo ? 0 : sinRiego.current + dt

    // Con "reducir movimiento" la regadera cambia de pose rápido y caen menos gotas
    const regando = moverRegadera(accion, activo, sinRiego.current, menosMovimiento ? 3 : 1)
    if (regando) {
      pendientes.current += dt * TASA * (menosMovimiento ? 0.4 : 1)
      while (pendientes.current >= 1) {
        pendientes.current -= 1
        soltarGota(gotas, boquilla)
      }
    } else {
      pendientes.current = 0
    }
    moverGotas(gotas, dt)
    dibujarGotas(gotas, malla.current)
  })

  return (
    <instancedMesh ref={malla} args={[undefined, undefined, MAX_GOTAS]} frustumCulled={false}>
      <sphereGeometry args={[0.026, 12, 8]} />
      <meshStandardMaterial color="#b9ddff" roughness={0.04} metalness={0.15} transparent opacity={0.8} />
    </instancedMesh>
  )
}

function prepararAccion(accion: THREE.AnimationAction) {
  accion.reset()
  accion.setLoop(THREE.LoopOnce, 1)
  accion.clampWhenFinished = true
  accion.play()
  accion.paused = true // arranca quieta, en el piso
}

/** Avanza o retrocede el clip. Devuelve true si la regadera está en pose de riego. */
function moverRegadera(accion: THREE.AnimationAction, activo: boolean, sinRiego: number, velocidad: number) {
  const duracion = accion.getClip().duration
  if (activo) {
    accion.timeScale = velocidad
    accion.paused = accion.time >= duracion
    return accion.time >= duracion
  }
  accion.timeScale = -velocidad
  accion.paused = accion.time <= 0 || sinRiego < ESPERA_AL_APAGAR
  return false
}

const origen = new THREE.Vector3()
const direccion = new THREE.Vector3()
const giro = new THREE.Quaternion()

function soltarGota(gotas: Gota[], boquilla: THREE.Object3D) {
  const gota = gotas.find((g) => !g.viva)
  if (!gota) return
  boquilla.getWorldPosition(origen)
  // El pico apunta en el +Y local de la boquilla (en Blender era su +Z)
  direccion.set(0, 1, 0).applyQuaternion(boquilla.getWorldQuaternion(giro))
  gota.viva = true
  gota.posicion.copy(origen).add(azar(0.06)) // la flor de riego tiene varios agujeros
  gota.velocidad.copy(direccion).multiplyScalar(VELOCIDAD_SALIDA).add(azar(DISPERSION))
}

function moverGotas(gotas: Gota[], dt: number) {
  for (const g of gotas) {
    if (!g.viva) continue
    g.velocidad.y -= GRAVEDAD * dt
    g.posicion.addScaledVector(g.velocidad, dt)
    const sobreLaMaceta = Math.hypot(g.posicion.x, g.posicion.z) < RADIO_TIERRA
    const piso = sobreLaMaceta ? ALTURA_TIERRA : 0
    if (g.posicion.y <= piso) g.viva = false
  }
}

const ARRIBA = new THREE.Vector3(0, 1, 0)
const auxiliar = new THREE.Object3D()
const sentido = new THREE.Vector3()

function dibujarGotas(gotas: Gota[], malla: THREE.InstancedMesh) {
  gotas.forEach((g, i) => {
    if (g.viva) {
      auxiliar.position.copy(g.posicion)
      // La gota se estira en la dirección en que cae
      auxiliar.quaternion.setFromUnitVectors(ARRIBA, sentido.copy(g.velocidad).normalize())
      auxiliar.scale.set(1, 1.5, 1)
    } else {
      auxiliar.scale.setScalar(0)
    }
    auxiliar.updateMatrix()
    malla.setMatrixAt(i, auxiliar.matrix)
  })
  malla.instanceMatrix.needsUpdate = true
}

function azar(escala: number) {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(escala)
}
