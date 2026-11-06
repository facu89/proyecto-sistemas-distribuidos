# Servicio

Es el "servicio" de [`../broker/topics.md`](../broker/topics.md). Hace tres cosas:

1. Se conecta al broker **por TLS** (puerto 8883) con el usuario `servicio`. La ACL solo le permite leer `+/sensor/+`, `+/actuador/+/estado` y `+/presencia`, y publicar en `+/actuador/+/cmd`.
2. Con cada lectura aplica las **reglas** y, si cambia la decisión, publica `on` u `off` en `{nodoId}/actuador/{tipo}/cmd`.
3. **Sirve la web** y le pasa el estado de los bancales por *Server-Sent Events* (SSE). El navegador no se conecta al broker ni tiene claves MQTT.

```
ESP32 ──MQTT/TLS──► EMQX ◄──MQTT/TLS (usuario "servicio")──► Servicio ──HTTP + SSE──► Navegador
                                                             ├─ reglas → publica /cmd
                                                             └─ sirve la web (dist/)
```

## Cómo se corre

Requiere Node 22.18 o más nuevo (corre el TypeScript directamente, sin compilar) y el broker levantado (`../broker/levantar.sh`).

```bash
cd software/servicio
pnpm install    # la primera vez
pnpm start      # o "pnpm dev", que se reinicia solo al cambiar el código
pnpm test       # tests de las reglas y del estado
pnpm typecheck  # revisión de tipos
```

El usuario y la clave MQTT se leen de `../broker/secrets/.env` (`MQTT_SERVICIO_USER` y `MQTT_SERVICIO_PASSWORD`), el mismo archivo con el que se cargan en MySQL. Lo demás tiene valores por defecto. Para cambiarlos, copiar `.env.example` como `.env`. Ahí están la URL del broker, la CA, el puerto HTTP y los umbrales de las reglas.

### ¿Por qué hay dos direcciones, `:8080` y `:5173`?

Es **una sola web**, pero se puede abrir de dos formas según lo que se esté haciendo:

| Dirección | Quién la sirve | Para qué |
|---|---|---|
| `http://localhost:8080` | El servicio (`pnpm start` acá) | **Uso normal.** Sirve la web ya compilada (`diseño_pagina_web/web/dist/`) y la API en el mismo lugar. Muestra la versión del último `pnpm build`. |
| `http://localhost:5173` | Vite (`pnpm dev` en `diseño_pagina_web/web`) | **Solo para desarrollar la web.** Cada cambio en React o en la escena 3D se ve al instante, sin compilar. Vite no tiene los datos: reenvía `/api` al servicio (`server.proxy` en `vite.config.ts`), así que el servicio también tiene que estar corriendo. |

En resumen:

- **Para usarla:** compilar la web una vez y abrir el servicio.
  ```bash
  cd diseño_pagina_web/web && pnpm build
  cd software/servicio && pnpm start        # http://localhost:8080
  ```
- **Para modificar la web:** dos terminales, y abrir la de Vite.
  ```bash
  cd software/servicio && pnpm dev          # datos en :8080
  cd diseño_pagina_web/web && pnpm dev      # http://localhost:5173
  ```
  Al terminar, `pnpm build` para que el `:8080` muestre los cambios.

Se podría meter Vite dentro del servicio para tener una sola dirección también al desarrollar. No se hizo para no mezclar las herramientas de desarrollo de la web con el servicio.

Por defecto el servicio escucha solo en esta máquina (`HTTP_HOST=127.0.0.1`). Para ver la web desde otro equipo de la red, poner `HTTP_HOST=0.0.0.0` en `.env` y abrir `http://<IP de la máquina>:8080`.

## Reglas

Están en `src/reglas.ts`, como funciones puras que se prueban en `src/reglas.test.ts`. Son la lógica propia del servicio, no el motor de reglas de EMQX.

| Actuador | Sensor | Se prende | Se apaga |
|---|---|---|---|
| Luz | `luz` (digital) | `0` (a oscuras) | `1` (hay luz) |
| Riego | `humedad_suelo` | menos de 20 % | 70 % o más |
| Ventilador | `temperatura_aire` | 28 °C o más | menos de 26 °C |

- **Histéresis:** entre el umbral de prender y el de apagar, el actuador sigue como estaba. Si todavía no se sabe cómo estaba (el servicio recién arranca), se toma como apagado.
- **Lecturas `nan`** (el sensor no respondió): no cambian nada.
- **Solo se publica cuando cambia la decisión**, no con cada lectura (llegan cada 5 s).
- **Reenvío al reconectar:** `/cmd` no es retenido y el ESP32 no recuerda las órdenes al reiniciarse. Por eso, cada vez que un nodo publica `online` en `{nodoId}/presencia`, el servicio le reenvía las órdenes vigentes.
- Los umbrales se cambian en `.env` (`RIEGO_*`, `VENTILADOR_*`) sin tocar el código.

## API para la web

| Ruta | Qué devuelve |
|---|---|
| `GET /api/estado` | El estado de todos los nodos en JSON |
| `GET /api/eventos` | SSE: el mismo JSON al conectarse y otra vez en cada cambio (evento `estado`) |
| Cualquier otra | Los archivos de `diseño_pagina_web/web/dist/` |

La forma del JSON es el tipo `Instantanea` de `src/bancal.ts`. La web lo importa de ahí (`import type`), así hay una sola definición. Por cada nodo trae: presencia, última lectura de cada sensor y, por actuador, `ordenado` (lo último que mandó el servicio) y `real` (lo que informó el ESP32 en `/estado`).

Mientras el firmware no publique `/estado`, `real` queda en `null` y la web muestra lo ordenado.

## Archivos

```
src/
├── main.ts         # une las piezas y maneja el cierre (Ctrl+C)
├── config.ts       # variables de entorno y valores por defecto
├── mqtt.ts         # conexión TLS, suscripciones y publicación de órdenes
├── reglas.ts       # las reglas (funciones puras) + reglas.test.ts
├── bancal.ts       # estado en memoria por nodo y cuándo ordenar + bancal.test.ts
└── http.ts         # web estática, /api/estado y /api/eventos
```
