import { useSyncExternalStore } from 'react'

const CONSULTA = '(prefers-reduced-motion: reduce)'

function suscribir(avisar: () => void) {
  const medios = window.matchMedia(CONSULTA)
  medios.addEventListener('change', avisar)
  return () => medios.removeEventListener('change', avisar)
}

/**
 * true si la persona pidió "reducir movimiento" en su sistema operativo.
 * Se actualiza solo si cambia la preferencia con la página abierta.
 */
export function useMenosMovimiento() {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  )
}
