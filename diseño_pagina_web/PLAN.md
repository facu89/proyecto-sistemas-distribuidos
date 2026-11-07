# Plan: home 3D de la página web

Boceto ("esqueleto") de la página principal, separado del resto del proyecto. Cuando esté conforme se adapta a la realidad del sistema (MQTT, nodos, sensores).

La home es una escena 3D inspirada en `concepto_home.jpeg`: una planta en una maceta y tres actuadores alrededor (lámpara, ventilador y regadera). Cada actuador tiene un estado **apagado** y uno **encendido**, y por ahora se cambian desde un **panel desplegable**.

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Modelado | Blender, exportado a **glTF binario (`.glb`)** | Es el formato estándar de 3D para la web y conserva materiales, jerarquía, esqueleto y animaciones. |
| Modelo base | Lo genera un script (`blender/generar_escena.py`) | Sirve de punto de partida con los nombres y pivotes correctos. Después se puede retocar a mano en `home.blend`. |
| Render en el navegador | **Three.js** en tiempo real (no videos pre-renderizados) | Permite combinar los estados libremente (por ejemplo, que la lámpara ilumine la planta) y hacer transiciones suaves. |
| Framework | **Vite + React + React Three Fiber + drei** | React Three Fiber permite usar Three.js desde React: el estado `{ luz, ventilador, riego }` pasa como props a la escena. drei trae `useGLTF`, `useAnimations`, `Environment` y `Line`. El panel y el futuro dashboard quedan en React normal. |
| Gestor de paquetes | pnpm | Es el que ya está instalado en la máquina. |

### Qué se anima en Blender y qué en código

Las partículas, la física y los nodos de geometría de Blender **no se exportan** a glTF. Por eso:

| Elemento | Dónde | Cómo |
|---|---|---|
| Planta con brisa | Blender | Esqueleto de 3 huesos en el tallo y acción en loop `Planta_Brisa` |
| Planta con viento | Blender | Acción en loop `Planta_Viento` (apenas inclinada lejos del ventilador, meciéndose algo más que con la brisa, sin sacudidas). La web la mezcla con la brisa según el ventilador. |
| Planta con "latido" | Blender | Acción en loop `Planta_Latido` (la flor se agranda dos veces). Por ahora no se usa. |
| Regadera: del piso a regando | Blender | Acción `Regadera_Regar`. Se reproduce hacia adelante al encender y hacia atrás al apagar. |
| Gotas de agua | Código | Muchas copias de una misma gota (`InstancedMesh`) que nacen en el empty `Regadera_Boquilla` |
| Aspas del ventilador | Código | Rotación con aceleración y frenado |
| Líneas de viento | Código | Curvas con un trazo animado |
| Lámpara encendida | Código | Se sube el brillo propio (*emissive*) de `Lampara_Vidrio` y `Lampara_Filamento`, y se enciende una luz puntual dentro de la lámpara |

## Contrato de nombres del modelo

La web busca los objetos del `.glb` **por nombre**. Si se retoca el modelo a mano hay que **respetar estos nombres y pivotes** (sin tildes ni ñ, porque Three.js limpia los nombres raros).

| Objeto (nodo glTF) | Tipo | Notas |
|---|---|---|
| `Maceta`, `Tierra` | malla | Estáticos |
| `Planta_Esqueleto` | armature | Huesos `Tallo_1`, `Tallo_2` y `Tallo_3` (este último lleva la flor) |
| `Planta` | malla con esqueleto | Tallo, hojas y flor en una sola malla |
| `Lampara` | empty (grupo) | Hijos: `Lampara_Vidrio`, `Lampara_Filamento`, `Lampara_Rosca` |
| `Ventilador` | empty (grupo) | Hijos: `Ventilador_Marco` y `Ventilador_Aspas` |
| `Ventilador_Aspas` | malla | Origen en el eje de giro. Gira sobre su **Y local de Blender**, que en glTF/Three.js pasa a ser el **Z local**. |
| `Regadera` | malla | Origen en el centro del cuerpo. La pose de reposo es "apagada" (apoyada en el piso). |
| `Regadera_Boquilla` | empty, hijo de `Regadera` | Punto desde donde salen las gotas |

| Material | Uso en la web |
|---|---|
| `Vidrio` y `Filamento` | Se exportan con el *emissive* apagado. La web les pone color cálido y sube `emissiveIntensity` al encender. |
| El resto (`Terracota`, `Tierra`, `Tallo`, `Hoja`, `Petalo`, `Centro_Flor`, `Metal_Rosca`, `Ventilador_Cuerpo`, `Ventilador_Aspa`, `Regadera`) | Estáticos |

| Animación (clip glTF) | Duración | Uso |
|---|---|---|
| `Planta_Brisa` | 4 s, loop | Con el ventilador apagado |
| `Planta_Viento` | 4 s, loop | Con el ventilador encendido. La web pasa de un clip al otro mezclando sus pesos (tarda unos 3 s). |
| `Planta_Latido` | 2 s, loop | Sin usar todavía (alternativa a la brisa) |
| `Regadera_Regar` | 1,5 s | Del piso a la pose de riego |

## Estructura de la carpeta

```
diseño_pagina_web/
├── PLAN.md
├── concepto_home.jpeg
├── blender/
│   ├── generar_escena.py   # genera home.blend, el .glb y las vistas previas
│   ├── home.blend          # escena generada; se puede retocar a mano
│   └── previews/           # renders de control (apagado / encendido)
├── modelos/
│   └── home.glb            # lo que consume la web
└── web/                    # fase 2 en adelante
```

## Fases

### Fase 1: modelo base en Blender ✅

- [x] Script que arma la escena con piezas separadas y nombradas según el contrato
- [x] Pivotes correctos: aspas en su eje y regadera en el centro del cuerpo
- [x] Esqueleto del tallo con pesos asignados (la flor completa va al hueso `Tallo_3`)
- [x] Acciones `Planta_Brisa`, `Planta_Viento`, `Planta_Latido` y `Regadera_Regar`
- [x] Exportación a `modelos/home.glb` y guardado de `blender/home.blend`
- [x] Vistas previas en Cycles de los dos estados, para comparar con el concepto
- [ ] *(opcional, cuando haya tiempo)* Retocar a mano en Blender: formas más orgánicas, textura de la terracota, tierra con relieve

Para regenerar todo (Blender está instalado como flatpak):

```bash
cd diseño_pagina_web
flatpak run --env=LD_LIBRARY_PATH=/app/blender/lib org.blender.Blender \
    --background --factory-startup --python "$PWD/blender/generar_escena.py"
# solo el .glb, sin renders (unos segundos en vez de ~1 min): agregar al final
#   -- --sin-previews
```

- La ruta tiene que ser absoluta (`$PWD/...`) porque el flatpak arranca en su propia carpeta.
- `LD_LIBRARY_PATH=/app/blender/lib` hace falta para la compresión: el flatpak trae `libmeshoptimizer.so` en esa carpeta pero el exportador no la busca ahí. Sin la variable, el script avisa y exporta sin comprimir (funciona igual, pesa 1,1 MB en vez de 437 KB).

> ⚠️ Regenerar **pisa** `home.blend`. Si se retoca a mano, de ahí en adelante se exporta desde Blender (*Archivo › Exportar › glTF 2.0*, formato `.glb`, con *Animación › Modo: Acciones*) y el script queda solo como referencia.

### Fase 2: proyecto web y escena estática ✅

- [x] Crear `web/` con Vite (plantilla `react-ts`) e instalar `three`, `@react-three/fiber` y `@react-three/drei`
- [x] Servir `modelos/home.glb`: se importa con `?url` desde `src/escena/Modelo.tsx` (Vite lo copia al build con hash) y `vite.config.ts` habilita la carpeta de arriba (`server.fs.allow`). No hay copias: regenerar el `.glb` actualiza la página.
- [x] Armar la escena: `<Canvas>` a pantalla completa, fondo gris cálido en CSS, entorno de estudio con `Lightformer`s locales (sin HDR descargado), luz direccional y sombras bajo la maceta y la regadera (ver Fase 5)
- [x] Cámara que ajusta el campo de visión a la ventana: en horizontal manda el alto de la escena y en vertical (celular) manda el ancho
- [x] Animación `Planta_Brisa` en loop

Ajustes respecto del modelo de Blender (en `prepararModelo`, dentro de `Modelo.tsx`):

- **Vidrio sin transmisión:** en Three.js la transmisión no "ve" el fondo CSS y la lámpara se veía oscura. Se usa un vidrio esmerilado semitransparente.
- **Tone mapping Neutral en vez de AgX:** el AgX de Three.js lavaba el amarillo de la flor. Con Neutral los colores quedan cerca del concepto.
- **Entorno con color de fondo:** sin esto el entorno era negro entre los paneles de luz y los metales (regadera, rosca) se veían oscuros.

Para correrla:

```bash
cd diseño_pagina_web/web
pnpm install   # la primera vez
pnpm dev       # http://localhost:5173
```

### Fase 3: estados y animaciones de los actuadores ✅

Cada actuador es un componente en `web/src/escena/actuadores/`.

- [x] Estado `{ luz, ventilador, riego }` con `useState` en `App` (`src/estado.ts`), todo en `false` al inicio. Los ids coinciden con el `{tipo}` de los tópicos MQTT.
- [x] **Luz** (`Lampara.tsx`): el vidrio y el filamento brillan, se enciende una luz puntual que ilumina la planta y un halo detrás imita el resplandor. Prende más rápido de lo que apaga.
- [x] **Ventilador** (`Ventilador.tsx`): las aspas aceleran y frenan con suavidad. Tres líneas de viento aparecen cuando las aspas ya giran rápido.
- [x] **Planta** (`Planta.tsx`): con el ventilador encendido, pasa de a poco de `Planta_Brisa` a `Planta_Viento`.
- [x] **Riego** (`Riego.tsx`): `Regadera_Regar` hacia adelante y, al llegar a la pose de riego, gotas desde `Regadera_Boquilla` que caen sobre la tierra. Al apagar, primero se cortan las gotas, espera ~0,5 s y la regadera vuelve al piso.

### Fase 4: panel desplegable ✅

- [x] Botón flotante arriba a la derecha ("Actuadores", con la cantidad de encendidos) que despliega el panel debajo
- [x] Un interruptor por actuador (Luz, Ventilador, Riego) con su ícono, texto de estado y color propio al encenderse
- [x] Accesible: interruptores con `role="switch"`, se cierra con Escape, foco visible con teclado
- [x] En celular, el panel ocupa el ancho de la pantalla
- [x] No se cierra al tocar la escena, para poder mirar la animación con el panel abierto

> Probado en Chrome sin ventana, controlado por su protocolo de depuración: se abrió el panel, se prendieron y apagaron los tres actuadores, se sacaron capturas de cada paso y no hubo errores en la consola.

### Fase 5: pulido ✅

- [x] **Viento más suave:** `Planta_Viento` ahora dura 4 s, se inclina la mitad y se mece sin sacudidas. La planta tarda unos 3 s en pasar de la brisa al viento; las aspas arrancan y frenan más despacio y las líneas de viento aparecen de a poco.
- [x] **Fondo:** arena cálida, apagada arriba y más clara en el piso (variables en `web/src/index.css`).
- [x] **Sombras:** `ContactShadows` de drei no dibujaba nada con el canvas transparente. Se reemplazó por sombras reales: la luz principal (más cenital) proyecta sobre un piso invisible con `ShadowMaterial`, con bordes suaves (PCF con `shadow.radius`; las VSM probadas antes bajaban a ~47 fps en la Radeon 610M integrada y trababan la animación). Proyectan la maceta, la planta y la regadera; la lámpara y el ventilador no, porque flotan.
- [x] **Cámara más lejos:** más margen alrededor de la escena y más distancia (menos deformación de perspectiva).
- [x] **Reducir movimiento** (`prefers-reduced-motion`): la planta queda quieta (solo cambia de pose con el ventilador), las aspas giran lento, las líneas de viento no avanzan, la regadera cambia de pose rápido y caen menos gotas. Se actualiza solo si cambia la preferencia.
- [x] **Pantalla de carga** propia (`Cargando.tsx`) con barra indeterminada, que se desvanece al terminar. Probada con red lenta simulada sobre el build de producción.
- [x] **Modelo comprimido** con Meshopt (`EXT_meshopt_compression`): de 1,1 MB a 438 KB. La web lo decodifica con el decodificador que trae drei, sin descargar nada externo. Requiere correr Blender con `LD_LIBRARY_PATH` (ver Fase 1).
  - El exportador guarda las rotaciones de las animaciones con 8 bits (fijo en su código), y la planta se veía trabada: entre 56 y 76 de cada 96 cuadros repetían el valor anterior. El script sube esa precisión a 16 bits antes de exportar: el error queda en 0,004° y el archivo crece 1 KB.
  - Para comparar contra un `.glb` sin comprimir: agregar `-- --sin-compresion` al comando. Genera `modelos/home.sin-compresion.glb` (ignorado por git) sin tocar `home.glb`, y se ve en la web con `?modelo=home.sin-compresion`.
- [x] **Opciones de prueba por URL** (`web/src/depuracion.ts`), combinables: `?fps` (contador de cuadros), `?modelo=<nombre>` (otro `.glb` de `modelos/`), `?sin-sombras`.
- [x] **Rendimiento medido con la GPU real** (Chrome sin ventana sobre la Radeon 610M, escena quieta):

  | Variante | fps | Cuadro p95 |
  |---|---|---|
  | Sombras VSM (antes) | ~47 | 33-67 ms |
  | Sin comprimir, VSM | ~47 | 33-67 ms |
  | Sin sombras | 60 | 16,7 ms |
  | **Sombras PCF (ahora)** | **60** | **16,7 ms** |

  La compresión no influye en los fps; las sombras VSM sí.
- [x] **Luz de la lámpara más notoria:** al encenderla, el estudio se atenúa como al caer la tarde (luz principal, relleno, entorno y la sombra que proyecta la luz principal bajan en ~1 s, en `Iluminacion.tsx`) y un velo CSS oscurece los bordes del fondo. La luz de la lámpara subió a 22 cd, así su tono cálido se nota en la flor y el ventilador. La lámpara no proyecta sombras: al estar justo encima de la planta casi no se verían y cuestan 6 renders extra por cuadro.
- [ ] *(pendiente)* Ajustar materiales y luces comparando con el concepto en un navegador real (las pruebas se hicieron con Chrome sin ventana y render por software)

### Fase 6: adaptar a la realidad ✅ (en parte)

Se cambió el enfoque: la web **no se conecta al broker**. El servicio ([`software/servicio`](../software/servicio/README.md)) se conecta por TLS, aplica las reglas, publica las órdenes y le pasa el estado a la web por Server-Sent Events. Los motivos están en [`topics.md`](../software/broker/topics.md) ("La web recibe los datos a través del servicio"), y por qué la web se abre en `:8080` o en `:5173` está en el README del servicio.

- [x] ~~Conectarse al broker con `mqtt.js` por WebSocket~~ → la web recibe los datos del servicio por SSE (`src/bancal.ts`, `useBancal()`)
- [x] La escena refleja el estado del bancal: lo que informe el ESP32 en `/estado` o, mientras el firmware no lo publique, lo último que ordenó el servicio. El panel marca "pendiente" cuando no coinciden.
- [x] **Choque con `topics.md` resuelto:** las órdenes las da solo el servicio, según sus reglas. El panel de actuadores pasó a ser de solo lectura ("Automático") y muestra la regla de cada uno.
- [x] Panel **Sensores** arriba a la izquierda: lecturas, presencia del nodo y estado de la conexión (servicio y broker)
- [x] Selección de nodo por URL (`?nodo=`); por defecto, el primero que informe el servicio
- [ ] Alertas (cuando el servicio las genere)
- [ ] Selector de bancal en la interfaz, cuando haya más de un nodo
- [x] **Modo automático / manual** en el panel de actuadores. En manual los interruptores le piden la orden al servicio (`POST`) y las reglas no actúan hasta volver a automático. Al volver se aplican las reglas con las últimas lecturas. El botón muestra la etiqueta "Manual".
- [ ] **Modificar los rangos desde la web:** editar los umbrales de riego y del cooler en el panel (`POST` al servicio). Habría que validar que el de apagar quede del lado correcto del de prender y guardarlos para que no se pierdan al reiniciar el servicio.

Lo que queda del sistema completo (firmware, broker, servicio) está en [Pendientes del README principal](../README.md#pendientes).

### Fase 7 (futuro): otros tipos de planta

Hoy la escena tiene una sola planta: la flor amarilla. La idea es poder mostrar otra según lo que haya en el bancal. **Por ahora no se modelan**; queda anotado qué implica.

| Planta | Cómo sería | Cómo se mueve |
|---|---|---|
| Flor (actual) | Un tallo, dos hojas y una flor grande | Brisa y viento sobre 3 huesos en el tallo |
| **Manzanilla** | Varios tallos finos que salen de la tierra, cada uno con una florcita blanca de centro amarillo y hojas finas tipo pluma | Cada tallo con 2 o 3 huesos y un desfase distinto, así no se mueven todos juntos. Con viento, se inclinan más que la flor porque son más finos. |
| **Suculenta** | Roseta baja de hojas gruesas y carnosas, sin tallo a la vista | Casi rígida: la brisa sería un "respirar" muy leve (las hojas se abren y cierran un poco). Con viento apenas se mece. |

Para que la web no tenga que cambiar (o cambie lo mínimo):

- [ ] Cada planta en su propio `.glb` (`planta_flor.glb`, `planta_manzanilla.glb`, `planta_suculenta.glb`) o como colecciones separadas dentro del mismo archivo; separar la maceta, la tierra y los actuadores del archivo de la planta.
- [ ] Respetar el mismo contrato: nodos `Planta` y `Planta_Esqueleto`, y los clips `Planta_Brisa` y `Planta_Viento`. Los huesos pueden variar en cantidad y nombre, porque la web solo mezcla los clips.
- [ ] Elegir la planta desde la configuración del bancal (o, mientras sea un boceto, con un parámetro `?planta=` como los de `depuracion.ts`).
- [ ] Ajustar la altura de la lámpara y del ventilador según la planta: la suculenta es mucho más baja que la flor.
