# Servicio

Es el "servicio" de [`../broker/topics.md`](../broker/topics.md). Hace tres cosas:

1. Se conecta al broker **por TLS** (puerto 8883) con el usuario `servicio`. La ACL solo le permite leer `+/sensor/+`, `+/actuador/+/estado` y `+/presencia`, y publicar en `+/actuador/+/cmd`.
2. Con cada lectura aplica las **reglas** y, si cambia la decisión, publica `1` (prender) o `0` (apagar) en `{nodoId}/actuador/{tipo}/cmd`.
3. **Sirve la web** y le pasa el estado de los bancales por *Server-Sent Events* (SSE). El navegador no se conecta al broker ni tiene claves MQTT.

```
ESP32 ──MQTT/TLS──► EMQX ◄──MQTT/TLS (usuario "servicio")──► Servicio ──HTTP + SSE──► Navegador
                                                             ├─ reglas → publica /cmd
                                                             └─ sirve la web (dist/)
```

## Cómo se corre

**Con Docker (lo normal):** `docker compose up -d` en `software/broker` levanta el servicio junto con el broker, en el contenedor `servicio` (imagen definida en [`Dockerfile`](Dockerfile), que también compila la web). Ver el [README del broker](../broker/README.md#cómo-se-levanta). Lo que sigue es para correrlo fuera de Docker, mientras se desarrolla.

Requiere Node 22.18 o más nuevo (corre el TypeScript directamente, sin compilar) y el broker levantado (`../broker/levantar.sh`).

```bash
cd software/servicio
pnpm install    # la primera vez
pnpm start      # o "pnpm dev", que se reinicia solo al cambiar el código
pnpm test       # tests de las reglas y del estado
pnpm typecheck  # revisión de tipos
```

El usuario y la clave MQTT se leen de `../broker/secrets/servicio.env` (`MQTT_SERVICIO_USER` y `MQTT_SERVICIO_PASSWORD`), el mismo archivo con el que se cargan en MySQL. Es el único archivo de secretos que ve el servicio (ver [Secretos](../broker/README.md#secretos-quién-ve-qué)). Lo demás tiene valores por defecto. Para cambiarlos, copiar `.env.example` como `.env`. Ahí están la URL del broker, la CA, el puerto HTTP y los umbrales de las reglas.

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
| Luz | `luz` (digital) | `0` (a oscuras), y dentro del horario si el bancal tiene uno | `1` (hay luz), o fuera del horario |
| Riego | `humedad_suelo` | menos de 20 % | 70 % o más |
| Cooler (ventilador) | `temperatura_aire` | 28 °C o más | menos de 26 °C |

- **Histéresis:** entre el umbral de prender y el de apagar, el actuador sigue como estaba. Si todavía no se sabe cómo estaba (el servicio recién arranca), se toma como apagado.
- **Lecturas `nan`** (el sensor no respondió): no cambian nada.
- **Solo se publica cuando cambia la decisión**, no con cada lectura (llegan cada 5 s).
- **Reenvío al reconectar:** `/cmd` no es retenido y el ESP32 no recuerda las órdenes al reiniciarse. Por eso, cada vez que un nodo publica `online` en `{nodoId}/presencia`, el servicio le reenvía las órdenes vigentes.
- Los valores de la tabla son **los de por defecto** (`.env`). Cada bancal puede tener los suyos: ver [Rangos por bancal](#rangos-por-bancal).

## Rangos por bancal

Cada bancal tiene sus rangos, que se cambian desde el panel de actuadores de la web (el lápiz de cada actuador). Los que nunca se cambiaron usan los **valores por defecto** de `.env` (`RIEGO_*`, `VENTILADOR_*`, `LUZ_HORARIO`).

| Actuador | Qué se configura | Controles |
|---|---|---|
| Riego | Prende bajo X %, apaga desde Y % | De 0 a 100 %, al menos 5 puntos entre X e Y |
| Cooler | Prende desde X °C, apaga bajo Y °C | De 0 a 50 °C, al menos 2 °C entre X e Y |
| Luz | Horario opcional: a oscuras prende solo dentro de él (puede cruzar la medianoche) | Formato `HH:MM`, inicio y fin distintos. Sin horario, prende siempre que esté oscuro |

- **Una sola validación:** `validarUmbrales` (`src/reglas.ts`) la usan el servicio y la web, así lo que el editor deja guardar es exactamente lo que el servicio acepta.
- **Se guarda antes de aplicarse:** el cambio va a `configuracion_nodo` y recién después se aplica. Si MySQL no responde, el pedido falla (503) y nada cambia. Aplicado el cambio, en automático se vuelven a evaluar las reglas con las últimas lecturas, sin esperar la próxima.
- **Al arrancar,** el servicio carga el modo y los rangos de MySQL antes de conectarse al broker, así las primeras lecturas ya se evalúan con los de cada bancal. Si MySQL todavía no responde, reintenta medio minuto. Después sigue con los valores por defecto y reintenta cada 30 s: apenas carga, cada bancal pasa a sus valores guardados.
- **El horario** es en hora local (`ZONA_HORARIA`, por defecto `America/Argentina/Buenos_Aires`), porque el servidor corre en UTC.

## Modo automático / manual

Cada nodo tiene un modo, y se cambia desde el panel de actuadores de la web:

- **Automático** (por defecto): el servicio ordena según las reglas de arriba.
- **Manual:** las reglas no ordenan nada. Las lecturas se siguen guardando y mostrando. Cada interruptor del panel le pide la orden al servicio y el servicio la publica en `/cmd`. Las órdenes siguen saliendo solo del servicio, como dice `topics.md`.

Detalles:

- **Al volver a automático** se aplican enseguida las reglas con las últimas lecturas, sin esperar la próxima. Por la histéresis, si una lectura está entre los umbrales de prender y de apagar, el actuador **queda como se dejó en manual**. Por ejemplo, con el riego prendido a mano y el suelo en 50 %, sigue regando hasta llegar a 70 %.
- **Las órdenes manuales también se reenvían** cuando el nodo se reconecta, igual que las automáticas.
- **El modo se guarda en MySQL** (`configuracion_nodo`) y se comparte entre todas las pestañas abiertas (llega por SSE). Si se reinicia el servicio, cada bancal vuelve con su modo. Lo que no se guarda son las órdenes manuales en sí: el ESP32 mantiene el estado y lo informa en `/estado` (retenido).

## API para la web

| Ruta | Qué hace |
|---|---|
| `GET /api/estado` | Devuelve el estado de todos los nodos en JSON |
| `GET /api/eventos` | SSE: el mismo JSON al conectarse y otra vez en cada cambio (evento `estado`) |
| `GET /api/historial?nodo=…&desde=…&hasta=…&tipo=…` | Lecturas guardadas en MySQL (ver [Historial](#historial)) |
| `POST /api/nodos/{nodoId}/umbrales` | Cambia los rangos del bancal (ver [Rangos por bancal](#rangos-por-bancal)). Cuerpo: `{"umbrales": {...}}` o `{"umbrales": null}` para volver a los de por defecto |
| `POST /api/nodos/{nodoId}/modo` | Cambia el modo. Cuerpo: `{"modo": "automatico"}` o `{"modo": "manual"}` |
| `POST /api/nodos/{nodoId}/actuadores/{tipo}` | Orden manual (`tipo` = `luz`, `cooler` o `riego`). Cuerpo: `{"encendido": true}` o `false`. Con el nodo en automático responde 409 |
| Cualquier otra | Los archivos de `diseño_pagina_web/web/dist/` |

Los `POST` responden 204 si salió bien, o un JSON `{"error": "..."}` con 400, 403, 404, 409 o 415.

La forma del JSON es el tipo `Instantanea` de `src/bancal.ts`. La web lo importa de ahí (`import type`), así hay una sola definición. Por cada nodo trae:
- el `modo`;
- la presencia;
- la última lectura de cada sensor;
- por actuador, `ordenado` (lo último que mandó el servicio) y `real` (lo que informó el ESP32 en `/estado`). La web marca "pendiente" mientras no coinciden.

Además, fuera de los nodos, trae `alertas`: las de `alertas/#` (las publica el motor de reglas de EMQX), por tópico sin el `alertas/` inicial (`nodo_offline/bancal1esp1`, `servicio`), cada una con `activa`, `desde` y el resto del JSON en `datos`. Ver [`topics.md`](../broker/topics.md#5-alertas).

### Seguridad de los `POST`

Manejan actuadores reales, así que el servicio solo los acepta:

- con `Content-Type: application/json`, y
- desde el mismo origen: si el navegador manda `Origin`, tiene que coincidir con `Host`.

Así otra página abierta en el mismo navegador no puede mandar órdenes al servicio, porque el navegador no envía JSON a otro origen sin permiso (CORS). Lo comprueba `src/http.test.ts`.

**No hay usuarios ni claves.** Cualquiera que pueda abrir la web puede cambiar el modo y manejar los actuadores. Por defecto el servicio escucha solo en esta máquina (`HTTP_HOST=127.0.0.1`). Con `0.0.0.0`, cualquier equipo de la red puede hacerlo. Agregar autenticación está en los pendientes.

## Historial

El dashboard de la web (botón **▲ Historial**) pide `GET /api/historial`:

| Parámetro | Qué es |
|---|---|
| `nodo` | Obligatorio, por ejemplo `bancal1esp1` |
| `desde`, `hasta` | En milisegundos desde 1970. Por defecto, las últimas 24 horas. Hasta 15 días de rango |
| `tipo` | Opcional: un solo sensor (`temperatura_aire`, `luz`...) |

Responde `{"nodo", "desde", "hasta", "series": {"temperatura_aire": [[instante_ms, valor], ...], ...}}`. El tipo está en `src/historial-tipos.ts` y la web lo importa de ahí.

**De dónde salen los datos:** el servicio no guarda nada. Las lecturas las escribe EMQX en `historial_lecturas`, con la regla `guardar_historial`: una por sensor cada 10 minutos, y borra las de más de 14 días. El servicio las lee con su usuario de MySQL, que sobre esa tabla solo puede hacer `SELECT` (ver el [README del broker](../broker/README.md#cambios-en-la-base-sin-perder-el-historial)).

- **Configuración:** el compose le pasa `MYSQL_HOST=mysql` y `MYSQL_SERVICIO_PASSWORD` sale de `secrets/servicio.env`.
- **Sin MySQL:** con `pnpm start` suelto no hay `MYSQL_HOST`, así que la ruta responde 503 y la web avisa que el historial no está disponible.

## Archivos

```
src/
├── main.ts         # une las piezas y maneja el cierre (Ctrl+C)
├── config.ts       # variables de entorno y valores por defecto
├── mqtt.ts         # conexión TLS, suscripciones y publicación de órdenes
├── reglas.ts       # las reglas (funciones puras) + reglas.test.ts
├── bancal.ts       # estado en memoria por nodo, modo y cuándo ordenar + bancal.test.ts
├── historial.ts    # consulta del historial en MySQL y validación de parámetros + historial.test.ts
├── historial-tipos.ts # forma del JSON de /api/historial (la importa la web)
└── http.ts         # web estática, /api/estado, /api/eventos, /api/historial y los POST + http.test.ts
```
