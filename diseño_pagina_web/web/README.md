# Home 3D

Página principal con la escena 3D de la planta y sus actuadores, más dos paneles desplegables: **Sensores** (arriba a la izquierda) y **Actuadores** (arriba a la derecha). El plan completo, las decisiones y el "contrato" de nombres del modelo están en [`../PLAN.md`](../PLAN.md).

Los datos los da el servicio ([`software/servicio`](../../software/servicio/README.md)) por Server-Sent Events en `/api/eventos`. La web no se conecta al broker.

```bash
pnpm install   # la primera vez
pnpm dev       # servidor de desarrollo en http://localhost:5173 (reenvía /api al servicio en :8080)
pnpm build     # chequeo de tipos y build de producción en dist/ (es lo que sirve el servicio)
pnpm lint      # oxlint
```

**¿`:5173` o `:8080`?** Es la misma web. Para *usarla*, alcanza con `pnpm build` y abrir el servicio en `http://localhost:8080`. `pnpm dev` (`:5173`) es para *modificarla*: muestra cada cambio al instante, pero necesita el servicio corriendo para tener datos. El detalle está en el [README del servicio](../../software/servicio/README.md#por-qué-hay-dos-direcciones-8080-y-5173).

Bancales: el botón **Vivero** de abajo al centro muestra el bancal elegido y despliega una card con todos los nodos que conoce el servicio (y los que tienen una alerta de nodo caído), en verde si está en línea y en rojo si está caído. Al elegir uno se escribe en la URL (`?nodo=bancal2esp1`), así ese link abre directo en ese bancal. Sin `?nodo=`, se muestra el primero.

Opciones de prueba en la URL (combinables): `?fps` muestra los cuadros por segundo, `?modelo=home.sin-compresion` carga el modelo sin comprimir y `?sin-sombras` apaga las sombras. Por ejemplo: `http://localhost:5173/?fps&sin-sombras`. Ver `src/depuracion.ts`.

Stack: Vite + React + TypeScript, [React Three Fiber](https://r3f.docs.pmnd.rs/) y [drei](https://drei.docs.pmnd.rs/).

El modelo **no** está en esta carpeta: se lee de `../modelos/home.glb`, que genera `../blender/generar_escena.py`.

## Estructura

```
src/
├── App.tsx                 # <Canvas>, pantalla de carga y paneles; toma el estado de useBancal()
├── bancal.ts               # conexión SSE con el servicio (useBancal) y estado para la escena
├── Cargando.tsx            # pantalla de carga (+ cargando.css)
├── estado.ts               # tipo { luz, ventilador, riego } que dibuja la escena
├── depuracion.ts           # opciones de prueba por URL (?fps, ?modelo, ?sin-sombras)
├── index.css               # fondo de estudio
├── escena/
│   ├── Escena.tsx          # arma la escena: cámara, luces y modelo
│   ├── CamaraAjustada.tsx  # encuadre que se adapta a la ventana
│   ├── Iluminacion.tsx     # entorno, luces, piso de sombras y atenuado con la lámpara
│   ├── Modelo.tsx          # carga home.glb, ajustes de materiales y sombras, reparte piezas a los actuadores
│   ├── useMenosMovimiento.ts # lee la preferencia "reducir movimiento" del sistema
│   └── actuadores/
│       ├── Planta.tsx      # mezcla de los clips de brisa y viento
│       ├── Lampara.tsx     # brillo, luz puntual y halo
│       ├── Ventilador.tsx  # giro de las aspas y líneas de viento
│       └── Riego.tsx       # clip de la regadera y gotas
└── panel/
    ├── PanelDesplegable.tsx # botón flotante + panel, común a los dos paneles
    ├── PanelLecturas.tsx   # sensores y estado de la conexión (arriba a la izquierda)
    ├── PanelActuadores.tsx # estado de cada actuador y su regla, solo lectura (arriba a la derecha)
    ├── panel.css
    └── iconos.tsx
```
