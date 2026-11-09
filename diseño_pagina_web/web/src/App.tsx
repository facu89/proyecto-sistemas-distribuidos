import { Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { type RefObject, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { estadoParaEscena, useBancal } from './bancal'
import { Cargando } from './Cargando'
import { DEPURACION } from './depuracion'
import { Dashboard } from './historial/Dashboard'
import { IconoFlecha } from './panel/iconos'
import { Escena } from './escena/Escena'
import { PanelActuadores } from './panel/PanelActuadores'
import { PanelLecturas } from './panel/PanelLecturas'

export default function App() {
  // El estado llega del servicio por SSE (bancal.ts). La escena muestra lo que informó el ESP32 o,
  // mientras el firmware no publique /estado, lo último que ordenó el servicio.
  const bancal = useBancal()
  const estado = estadoParaEscena(bancal.nodo)
  const botonHistorial = useRef<HTMLButtonElement>(null)
  const historial = useHistorialAbierto(botonHistorial)

  return (
    <main className="home">
      {/* Velo de "atardecer" sobre el fondo CSS cuando se enciende la lámpara.
          Acompaña al estudio 3D, que se atenúa en Iluminacion.tsx. */}
      <div className="ambiente" data-lampara={estado.luz} aria-hidden />
      <Canvas
        dpr={[1, 2]}
        // Con el historial abierto la escena no se ve: se deja de dibujar para no gastar CPU ni batería
        frameloop={historial.abierto ? 'never' : 'always'}
        // Sombras PCF: el difuminado se hace solo en los píxeles del piso que reciben sombra.
        // Las VSM (más suaves) desenfocaban el mapa entero en cada cuadro y en una placa
        // integrada bajaban a ~47 fps con cuadros de 50-66 ms: la animación se veía trabada.
        shadows={DEPURACION.sombras ? 'percentage' : false}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          // Neutral (Khronos PBR Neutral) respeta mejor los colores base que AgX,
          // que en Three.js lava bastante el amarillo de la flor.
          gl.toneMapping = THREE.NeutralToneMapping
          gl.toneMappingExposure = 1.0
        }}
      >
        <Suspense fallback={null}>
          <Escena estado={estado} />
        </Suspense>
      </Canvas>
      <Cargando />
      {DEPURACION.fps && <Stats />}
      <PanelLecturas conexion={bancal.conexion} broker={bancal.broker} nodoId={bancal.nodoId} nodo={bancal.nodo} />
      <PanelActuadores
        estado={estado}
        nodoId={bancal.nodoId}
        nodo={bancal.nodo}
        umbrales={bancal.umbrales}
        disponible={bancal.conexion === 'conectada' && bancal.broker}
      />
      <button
        ref={botonHistorial}
        type="button"
        className="historial-abrir"
        aria-expanded={historial.abierto}
        onClick={historial.abrir}
      >
        <IconoFlecha hacia="arriba" />
        Historial
      </button>
      <Dashboard abierto={historial.abierto} alCerrar={historial.cerrar} nodoId={bancal.nodoId} umbrales={bancal.umbrales} />
    </main>
  )
}

/**
 * Abre y cierra el historial. Al abrirlo se agrega una entrada al historial del navegador, así el
 * "atrás" del celular lo cierra en vez de salir de la página. Al cerrarlo, el foco vuelve al botón.
 */
function useHistorialAbierto(boton: RefObject<HTMLButtonElement | null>) {
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    const alVolver = () => setAbierto(window.history.state?.historial === true)
    window.addEventListener('popstate', alVolver)
    return () => window.removeEventListener('popstate', alVolver)
  }, [])

  const abrir = useCallback(() => {
    window.history.pushState({ historial: true }, '')
    setAbierto(true)
  }, [])

  const cerrar = useCallback(() => {
    // Si se abrió con abrir(), "atrás" saca esa entrada y popstate lo cierra
    if (window.history.state?.historial === true) window.history.back()
    else setAbierto(false)
    boton.current?.focus({ preventScroll: true })
  }, [boton])

  return { abierto, abrir, cerrar }
}
