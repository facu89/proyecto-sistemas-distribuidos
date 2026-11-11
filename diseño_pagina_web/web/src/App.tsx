import { Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import * as THREE from 'three'
import { estadoParaEscena, useBancal } from './bancal'
import { Cargando } from './Cargando'
import { DEPURACION } from './depuracion'
import { Escena } from './escena/Escena'
import { AvisosConexion } from './panel/AvisosConexion'
import { PanelActuadores } from './panel/PanelActuadores'
import { PanelLecturas } from './panel/PanelLecturas'
import { SelectorBancal } from './panel/SelectorBancal'

export default function App() {
  // El estado llega del servicio por SSE (bancal.ts). La escena muestra lo que informó el ESP32 o,
  // mientras el firmware no publique /estado, lo último que ordenó el servicio.
  const bancal = useBancal()
  const estado = estadoParaEscena(bancal.nodo)

  return (
    <main className="home">
      {/* Velo de "atardecer" sobre el fondo CSS cuando se enciende la lámpara.
          Acompaña al estudio 3D, que se atenúa en Iluminacion.tsx. */}
      <div className="ambiente" data-lampara={estado.luz} aria-hidden />
      <Canvas
        dpr={[1, 2]}
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
      <SelectorBancal lista={bancal.lista} nodoId={bancal.nodoId} onElegir={bancal.elegirNodo} />
      <AvisosConexion avisos={bancal.avisos} />
    </main>
  )
}
