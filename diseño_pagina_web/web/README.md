# Home 3D (boceto)

Página principal con la escena 3D de la planta y sus actuadores. El plan completo, las decisiones y el "contrato" de nombres del modelo están en [`../PLAN.md`](../PLAN.md).

```bash
pnpm install   # la primera vez
pnpm dev       # servidor de desarrollo en http://localhost:5173
pnpm build     # chequeo de tipos y build de producción en dist/
pnpm lint      # oxlint
```

Opciones de prueba en la URL (combinables): `?fps` muestra los cuadros por segundo, `?modelo=home.sin-compresion` carga el modelo sin comprimir y `?sin-sombras` apaga las sombras. Por ejemplo: `http://localhost:5173/?fps&sin-sombras`. Ver `src/depuracion.ts`.

Stack: Vite + React + TypeScript, [React Three Fiber](https://r3f.docs.pmnd.rs/) y [drei](https://drei.docs.pmnd.rs/).

El modelo **no** está en esta carpeta: se lee de `../modelos/home.glb`, que genera `../blender/generar_escena.py`.

## Estructura

```
src/
├── App.tsx                 # estado de los actuadores, <Canvas>, pantalla de carga y panel
├── Cargando.tsx            # pantalla de carga (+ cargando.css)
├── estado.ts               # tipo y estado inicial { luz, ventilador, riego }
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
    ├── PanelActuadores.tsx # botón y panel desplegable con los interruptores
    ├── panel.css
    └── iconos.tsx
```
