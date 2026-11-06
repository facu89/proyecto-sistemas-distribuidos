import { Stats } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Suspense, useState } from 'react'
import * as THREE from 'three'
import { Cargando } from './Cargando'
import { DEPURACION } from './depuracion'
import { Escena } from './escena/Escena'
import { ESTADO_INICIAL, type Actuador } from './estado'
import { PanelActuadores } from './panel/PanelActuadores'

export default function App() {
  // Por ahora el estado vive solo en la página. Más adelante lo va a alimentar MQTT
  // (`{nodoId}/actuador/{tipo}/estado`) y el panel va a pedir los cambios al servicio.
  const [estado, setEstado] = useState(ESTADO_INICIAL)
  const cambiar = (actuador: Actuador, encendido: boolean) =>
    setEstado((anterior) => ({ ...anterior, [actuador]: encendido }))

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
      <PanelActuadores estado={estado} onCambiar={cambiar} />
    </main>
  )
}
