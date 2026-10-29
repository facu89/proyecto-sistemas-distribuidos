# Diseño de tópicos

Todos los tópicos empiezan con `plantas/` y van en minúscula (MQTT distingue mayúsculas).
`{planta}` identifica la planta y `{esp}` el ESP32 que la atiende. Ejemplo: `plantas/1/esp/1/...`

## Resumen

| Tópico | Publica | Se suscribe | QoS | Retain |
|---|---|---|---|---|
| `plantas/{planta}/esp/{esp}/sensor/{temperatura\|humedad\|luz}` | ESP | Servicio y dashboard: `plantas/+/esp/+/sensor/#` | 0 | No |
| `plantas/{planta}/esp/{esp}/actuador/{luz\|riego}` | Servicio | Cada ESP, solo lo suyo: `plantas/{planta}/esp/{esp}/actuador/+` | 1 | No |
| `plantas/{planta}/esp/{esp}/actuador/{luz\|riego}/estado` | ESP | Servicio y dashboard: `plantas/+/esp/+/actuador/+/estado` | 1 | Sí |
| `plantas/{planta}/esp/{esp}/presencia` | ESP ("online") / broker por Last Will ("offline") | Servicio y dashboard: `plantas/+/esp/+/presencia` | 1 | Sí |

## Detalle

### 1. Medición de datos (sensores)

`plantas/{planta}/esp/{esp}/sensor/{temperatura|humedad|luz}`

Ejemplo: `plantas/1/esp/1/sensor/temperatura`, con payload `23.5`.

- **Publica:** el ESP, cada vez que lee un sensor.
- **Se suscriben:** el servicio (para decidir cuándo actuar) y el dashboard (para mostrar los datos y las alertas visuales), con `plantas/+/esp/+/sensor/#`. El `+` significa "cualquier planta / cualquier ESP" y el `#`, "todos los sensores".
- **QoS 0:** si se pierde una lectura, enseguida llega la próxima. No justifica el costo de confirmar cada mensaje.
- **Retain no:** el valor cambia todo el tiempo y la próxima lectura llega en pocos segundos.

### 2. Acciones (actuadores)

`plantas/{planta}/esp/{esp}/actuador/{luz|riego}`

Ejemplo: `plantas/1/esp/1/actuador/riego`, con payload `on` u `off`.

- **Publica:** solo el servicio, cuando decide activar o desactivar algo.
- **Se suscribe:** cada ESP, solo a sus propios actuadores, con `plantas/{planta}/esp/{esp}/actuador/+`. Se usa `+` (un solo nivel) y no `#`, para que el ESP no reciba sus propios mensajes de `/estado` como si fueran órdenes.
- **QoS 1:** una orden perdida puede ser grave (por ejemplo, el sistema envía `off` al riego, se pierde y la planta se inunda). Si llega dos veces no pasa nada: `on` u `off` repetido deja el mismo resultado (la orden es idempotente). Por eso no hace falta QoS 2.
- **Retain no:** si la orden quedara retenida, el ESP la recibiría y la volvería a ejecutar cada vez que se reconecta.

### 3. Estado de los actuadores

`plantas/{planta}/esp/{esp}/actuador/{luz|riego}/estado`

Ejemplo: `plantas/1/esp/1/actuador/riego/estado`, con payload `on` u `off`.

- **Publica:** el ESP, después de ejecutar una orden, con el estado real del actuador. Sirve para saber si el actuador realmente se encendió o si hubo un error (por ejemplo, falló el relé).
- **Se suscriben:** el servicio y el dashboard, con `plantas/+/esp/+/actuador/+/estado`.
- **QoS 1:** no se puede perder, porque el dashboard mostraría un estado falso o el sistema no podría decidir con exactitud cuándo actuar. Si se repite no pasa nada, porque es el mismo estado.
- **Retain sí:** un dashboard que recién se abre ve al instante si el riego o la luz están prendidos, sin esperar al próximo cambio.

### 4. Presencia (Last Will)

`plantas/{planta}/esp/{esp}/presencia`

- **Publica:** el ESP publica `online` al conectarse. Al conectarse, también deja registrado en el broker un **Last Will** (`offline`): si el ESP se corta sin avisar (se apaga, pierde WiFi), el broker lo detecta por el keepalive y publica `offline` en su nombre.
- **Se suscriben:** el servicio y el dashboard, con `plantas/+/esp/+/presencia`.
- **QoS 1:** es importante saber si el equipo está activo, así que no se puede perder. Si el mensaje se repite (por ejemplo, `offline` dos veces) no pasa nada.
- **Retain sí:** quien se conecta después ve enseguida si cada ESP está activo o no.

## Decisiones de diseño

- **Un tópico por sensor** (en vez de un solo mensaje con todos los datos): el payload es solo un número, se puede suscribir a una sola magnitud y las reglas de EMQX por umbral (por ejemplo, humedad baja) quedan simples.
- **Separación `sensor` / `actuador`:** permite que la ACL diga claramente "el ESP publica en `sensor` y lee `actuador`; el servicio, al revés".
- **Las órdenes las da solo el servicio:** el dashboard solo lee. Así nadie puede activar un actuador sin pasar por el servicio.
- **Las alertas visuales** (por ejemplo, "humedad baja") las calcula el dashboard a partir de los datos de los sensores. Las decisiones que actúan (regar, prender la luz) las toma el servicio.
