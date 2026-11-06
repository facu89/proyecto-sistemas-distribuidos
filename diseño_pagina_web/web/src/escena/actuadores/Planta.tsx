import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

type Props = {
  brisa?: THREE.AnimationAction | null
  viento?: THREE.AnimationAction | null
  hayViento: boolean
  menosMovimiento: boolean
}

/**
 * Qué tan rápido pasa de la brisa al viento (más alto = más rápido). Bajo a propósito:
 * tarda unos 3 s en llegar al viento pleno, así se ve como aire que la acaricia
 * y no como un golpe.
 */
const SUAVIDAD_ENTRADA = 0.7
const SUAVIDAD_SALIDA = 0.5

/**
 * La planta reproduce dos clips a la vez y los mezcla:
 * `Planta_Brisa` (balanceo lento) y `Planta_Viento` (algo inclinada y meciéndose más).
 * Con el ventilador encendido el peso pasa de a poco al viento, y al apagarlo vuelve.
 *
 * Con "reducir movimiento" los clips quedan quietos: la planta solo cambia de pose
 * (se inclina) cuando se prende el ventilador.
 */
export function Planta({ brisa, viento, hayViento, menosMovimiento }: Props) {
  const mezcla = useRef(0) // 0 = solo brisa, 1 = solo viento

  useEffect(() => {
    if (!brisa || !viento) return
    iniciar(brisa, 1)
    iniciar(viento, 0)
    return () => {
      brisa.stop()
      viento.stop()
    }
  }, [brisa, viento])

  useFrame((_, delta) => {
    if (!brisa || !viento) return
    const suavidad = hayViento ? SUAVIDAD_ENTRADA : SUAVIDAD_SALIDA
    mezcla.current = THREE.MathUtils.damp(mezcla.current, hayViento ? 1 : 0, suavidad, delta)
    mezclar(brisa, viento, mezcla.current, menosMovimiento ? 0 : 1)
  })

  return null
}

function iniciar(accion: THREE.AnimationAction, peso: number) {
  accion.reset().setEffectiveWeight(peso).play()
}

function mezclar(brisa: THREE.AnimationAction, viento: THREE.AnimationAction, mezcla: number, velocidad: number) {
  brisa.setEffectiveWeight(1 - mezcla)
  viento.setEffectiveWeight(mezcla)
  brisa.timeScale = velocidad
  viento.timeScale = velocidad
}
