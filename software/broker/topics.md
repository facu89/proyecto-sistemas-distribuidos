# Diseño de tópicos

Todos los tópicos van en minúscula (MQTT distingue mayúsculas: `Actuador` y `actuador` son tópicos distintos).
Lo que está entre llaves `{}` es una parte variable del tópico; el resto es fijo.

- `{nodoId}` identifica al nodo. Hay un solo ESP32 por bancal, así que el nodo es el bancal junto con su ESP32. Es **un solo nivel** del tópico. Ejemplo: `bancal1esp1`.
- `alertas` está reservado: no puede usarse como `{nodoId}`, porque es la raíz de las alertas.
- `{tipo}` es el nombre del componente (`riego`, `luz`, `temperatura`, `humedad`...). Es un solo nivel, así que hay un solo componente de cada tipo por nodo. Ejemplo: `riego`.

Participantes:

- **ESP32:** lee los sensores y maneja los actuadores de su nodo.
- **Servicio** ([`software/servicio`](../servicio/README.md)): recibe las lecturas, decide cuándo actuar y le pasa todo (también las alertas) a la web.
- **Motor de reglas de EMQX** ([`config/emqx.conf`](config/emqx.conf)): corre dentro del broker. Genera las alertas, guarda el historial de lecturas en MySQL y avisa por Telegram.
- **Usuario:** la interfaz que ve una persona (la web, [`diseño_pagina_web/web`](../../diseño_pagina_web/web/README.md)). Solo lee. **No se conecta al broker:** recibe del servicio, por HTTP con Server-Sent Events (`/api/eventos`), lo mismo que le llega por estos tópicos. Ver "La web recibe los datos a través del servicio" en las decisiones de diseño.

Todos se conectan al broker por TLS (puerto 8883), verificando el certificado del broker con la CA del proyecto (ver [`README.md`](README.md)).

## Resumen

| Tópico | Nombre | Publica | Se suscriben | QoS | Retain |
|---|---|---|---|---|---|
| `{nodoId}/actuador/{tipo}/cmd` | Activar | Servicio | ESP32 (solo su nodo) y Usuario | 1 | No |
| `{nodoId}/actuador/{tipo}/estado` | Estado del actuador | ESP32 | Usuario y Servicio | 1 | Sí |
| `{nodoId}/sensor/{tipo}` | Lectura de sensor | ESP32 | Usuario y Servicio | 0 | No |
| `{nodoId}/presencia` | Presencia | ESP32 (`online`) / broker por Last Will (`offline`) | Usuario y Servicio | 1 | Sí |
| `alertas/nodo_offline/{nodoId}` | Nodo caído | Broker (regla `alerta_nodo_offline`) | Servicio (→ Usuario) y regla `notificar_telegram` | 1 | Sí |
| `alertas/servicio` | Servicio caído | Broker (regla `vigilar_servicio`) | Servicio (→ Usuario) | 1 | Sí |
| `{nodoId}/config` | Configuración del bancal | Servicio | ESP32 (solo su nodo) | 1 | Sí |
| `{nodoId}/config/aplicada` | Configuración aplicada | ESP32 | Servicio (→ Usuario) | 1 | Sí |
| `servicio/conexion` | Servicio en línea | Servicio (`online`) / broker por Last Will (`offline`) | ESP32 | 1 | Sí |

Filtros de suscripción de cada participante:

| Participante | Filtros |
|---|---|
| ESP32 | `{nodoId}/actuador/+/cmd` y `{nodoId}/config` (solo los de su propio nodo), `servicio/conexion` |
| Servicio | `+/sensor/+`, `+/actuador/+/estado`, `+/presencia`, `+/config/aplicada`, `alertas/#` |
| Motor de reglas de EMQX | `+/presencia`, `+/sensor/+`, `alertas/nodo_offline/+` y los eventos `$events/client_connected` y `$events/client_disconnected` |
| Usuario | Ninguno: no se conecta al broker. El servicio le pasa las lecturas, las órdenes que dio, el estado de los actuadores, la presencia y las alertas. |

La tabla de resumen dice "Usuario" en *Se suscriben* porque recibe esos datos, aunque le lleguen a través del servicio. En la ACL quedó el usuario MQTT `cliente_web`, de solo lectura (`+/sensor/+`, `+/actuador/+/estado`, `+/presencia` y `alertas/#`), por si más adelante se quiere un cliente que lea directo del broker (por ejemplo, para depurar).

`+` reemplaza exactamente un nivel ("cualquier nodo", "cualquier tipo") y `#` reemplaza todos los niveles que siguen.

## Detalle

### 1. Activar (actuadores)

`{nodoId}/actuador/{tipo}/cmd`

Ejemplo: `bancal1esp1/actuador/luz/cmd`, con payload `1` (prender) o `0` (apagar). El ESP32 también acepta `on` y `off`.

- **Publica:** solo el servicio, cuando decide activar o desactivar algo.
- **Se suscribe el ESP32:** solo a los actuadores de su nodo, con `{nodoId}/actuador/+/cmd`. Ver "Comando en `/cmd`" en las decisiones de diseño.
- **Se suscribe el usuario:** para ver qué ordenó el servicio. Ver "El usuario escucha las órdenes" en las decisiones de diseño.
- **QoS 1:** una orden perdida puede ser grave (por ejemplo, el servicio envía `0` al riego, se pierde y la planta se inunda). Si llega dos veces no pasa nada: `1` o `0` repetido deja el mismo resultado (la orden es idempotente). Por eso no hace falta QoS 2.
- **Retain no:** si la orden quedara retenida, el ESP32 la recibiría y la volvería a ejecutar cada vez que se reconecta.

### 2. Estado del actuador

`{nodoId}/actuador/{tipo}/estado`

Ejemplo: `bancal1esp1/actuador/luz/estado`, con payload `1` (prendido) o `0` (apagado).

- **Publica:** el ESP32, después de ejecutar una orden, con el estado real del actuador. Sirve para saber si el actuador realmente se encendió o si hubo un error (por ejemplo, falló el relé).
- **Se suscriben:** el usuario y el servicio, con `+/actuador/+/estado`.
- **QoS 1:** no se puede perder, porque el usuario vería un estado falso o el servicio no podría decidir con exactitud cuándo actuar. Si se repite no pasa nada, porque es el mismo estado.
- **Retain sí:** un usuario que recién se conecta ve al instante si el riego o la luz están prendidos, sin esperar al próximo cambio.

### 3. Lectura de sensor

`{nodoId}/sensor/{tipo}`

Ejemplo: `bancal1esp1/sensor/humedad`, con payload `41.2`.

- **Publica:** el ESP32, cada vez que lee un sensor.
- **Se suscriben:** el servicio (para decidir cuándo actuar y cuándo generar una alerta) y el usuario (para mostrar los datos), con `+/sensor/+`.
- **QoS 0:** si se pierde una lectura, enseguida llega la próxima. No justifica el costo de confirmar cada mensaje.
- **Retain no:** el valor cambia todo el tiempo y la próxima lectura llega en pocos segundos.

### 4. Presencia (Last Will)

`{nodoId}/presencia`

Ejemplo: `bancal1esp1/presencia`, con payload `online` u `offline`.

- **Publica:** el ESP32 publica `online` al conectarse. Al conectarse, también deja registrado en el broker un **Last Will** (`offline`): si el ESP32 se corta sin avisar (se apaga, pierde WiFi), el broker lo detecta por el keepalive y publica `offline` en su nombre.
- **Keepalive de 10 s:** el ESP32 manda un PING cada ~5 s (la mitad del keepalive). Si el broker no recibe nada durante 1,5 × 10 = 15 s, da al ESP32 por muerto y publica el Last Will. Por cómo el broker revisa los plazos, en la práctica el `offline` puede tardar algunos segundos más.
- **Se suscriben:** el usuario y el servicio, con `+/presencia`.
- **QoS 1:** es importante saber si el nodo está activo, así que no se puede perder. Si el mensaje se repite (por ejemplo, `offline` dos veces) no pasa nada.
- **Retain sí:** quien se conecta después ve enseguida si cada nodo está activo o no.

### 5. Alertas

`alertas/...`

Las publica **el broker**, con su motor de reglas ([`config/emqx.conf`](config/emqx.conf)), no un cliente. Todas tienen un payload JSON con al menos `activa` (`true` mientras el problema sigue, `false` cuando se resolvió) y `desde` (ms desde 1970, la hora del broker).

| Tópico | Regla que la publica | A partir de | Payload |
|---|---|---|---|
| `alertas/nodo_offline/{nodoId}` | `alerta_nodo_offline` | `+/presencia` (`offline` → activa, `online` → resuelta) | `{"nodo": "bancal1esp1", "activa": true, "desde": 1700000000000}` |
| `alertas/servicio` | `vigilar_servicio` | eventos del broker `$events/client_disconnected` / `client_connected` del usuario `servicio` | `{"activa": true, "motivo": "dejó de responder", "desde": 1700000000000}` |

- **Se suscriben:** el servicio, con `alertas/#`, que se las pasa a la web en el campo `alertas` de la instantánea (SSE). La regla `notificar_telegram` lee `alertas/nodo_offline/+` y manda el aviso por Telegram. `vigilar_servicio` manda el suyo directamente.
- **QoS 1:** una alerta perdida es una alerta que nadie ve. Si llega repetida no pasa nada, porque es el mismo estado.
- **Retain sí:** cada alerta representa un estado que se mantiene ("el nodo está caído"), no un evento puntual. Quien se conecta después ve enseguida cuáles siguen activas. Cuando se resuelve, no se borra: se publica la misma alerta con `activa: false`.
- **El nodo va en el tópico** (`alertas/nodo_offline/{nodoId}`): así cada nodo tiene su propia alerta retenida y la de un nodo no pisa la de otro.

### 6. Configuración del bancal (las reglas corren en el ESP32)

El ESP32 aplica las reglas él mismo (`firmware/src/reglas.c`): así el bancal sigue regando, ventilando y prendiendo la luz aunque se caiga el servicio, el broker o internet. El servicio le manda **qué** reglas usar.

| Tópico | Payload | Notas |
|---|---|---|
| `{nodoId}/config` | `{"v": 1731264000000, "modo": "automatico", "riego": [20, 70], "cooler": [28, 26], "pulso": [5, 2], "luz": null, "tz": "<-03>3"}` | `riego`: prende bajo / apaga desde (%). `cooler`: prende desde / apaga bajo (°C). `pulso`: segundos de cada riego y lecturas de espera después. `luz`: `null` o `["18:00", "23:00"]`. `tz`: zona horaria POSIX para el horario. `v`: versión, crece con cada cambio |
| `{nodoId}/config/aplicada` | `{"v": 1731264000000, "modo": "manual", "efectivo": "automatico"}` | La versión que está usando y el modo en que funciona de verdad |
| `servicio/conexion` | `online` / `offline` | El servicio publica `online` al conectarse y `offline` al cerrar; si muere, el broker publica `offline` por él (Last Will) |

- **Retenido `config`:** el ESP32 recibe su configuración apenas se conecta, aunque el servicio no esté. Además la guarda en su memoria permanente (NVS): si se reinicia sin broker, sigue con la última.
- **Manual sin servicio → automático:** en manual las órdenes vienen de la web a través del servicio. Si el servicio se cae (`servicio/conexion` = `offline`) o el ESP32 pierde el broker, nadie podría manejarlo, así que pasa a automático en el acto. Cuando el servicio vuelve, retoma el modo configurado.
- **`config/aplicada`:** el servicio sabe si el bancal ya aplicó la última configuración (la web lo muestra) y en qué modo está de verdad. También le dice al servicio que ese ESP32 aplica las reglas: desde ahí el servicio deja de mandarle órdenes en automático. Con un firmware viejo, que no lo publica, el servicio sigue decidiendo como antes.
- **Riego por pulsos**, en automático y en manual: la bomba prende `pulso[0]` segundos (5) y se apaga sola; después espera `pulso[1]` lecturas (2, unos 10 s) para que el agua llegue al sensor antes de poder regar de nuevo. En automático sigue dando pulsos mientras la humedad no llegue al umbral de apagar; en manual, cada "prender" es un pulso, y una orden durante la espera se ignora.
- **La hora** (para el horario de la luz) la toma el ESP32 por NTP de internet. Sin hora, ignora el horario y prende la luz siempre que esté oscuro.

## Decisiones de diseño

- **Un tópico por sensor** (en vez de un solo mensaje con todos los datos): el payload es solo un número, se puede suscribir a una sola magnitud y las reglas por umbral (por ejemplo, humedad baja) quedan simples.
- **Separación `sensor` / `actuador`:** permite que la ACL diga claramente "el ESP32 publica en `sensor` y en `actuador/.../estado`, y lee `actuador/.../cmd`; el servicio, al revés".
- **`{nodoId}` de un solo nivel, igual al usuario MQTT del ESP32:** cada ESP32 se autentica en el broker con su `{nodoId}` como usuario. Así la ACL se escribe con una única regla genérica para todos los nodos ("cada ESP32 solo publica y lee tópicos que empiezan con su propio `{nodoId}`"), sin cargar una regla por equipo, y ningún ESP32 puede publicar datos en nombre de otro nodo.
- **Comando en `/cmd` y estado en `/estado`:** el comando y el estado de un actuador son dos subtópicos hermanos, al mismo nivel (`.../riego/cmd` y `.../riego/estado`). Si el comando fuera el propio `.../riego` y el estado un subtópico suyo, el ESP32 tendría que suscribirse con un filtro exacto de un nivel (`{nodoId}/actuador/+`) y cuidarse de no usar nunca `#`, porque recibiría sus propios mensajes de `/estado` como si fueran órdenes y podría entrar en un bucle (publica `1` como estado, lo lee como orden, lo vuelve a ejecutar). Con `/cmd` el ESP32 se suscribe solo a lo que termina en `cmd`, no hay forma de confundir una cosa con la otra, y la ACL queda simple: el ESP32 lee `.../cmd` y publica `.../estado`; el servicio, al revés.
- **Las reglas corren en el bancal** y el servicio es quien las configura: ver la sección 6. Así un corte del servicio, del broker o de internet no deja los actuadores trabados (un riego prendido, una luz que no se apaga).
- **Las órdenes las da solo el servicio:** el usuario no publica en el broker. Así nadie puede activar un actuador sin pasar por el servicio. En **modo manual** (se elige en la web), el usuario le *pide* al servicio prender o apagar un actuador y el servicio publica la orden en `/cmd`. Ver el [README del servicio](../servicio/README.md#modo-automático--manual).
- **El usuario ve las órdenes**, no solo el estado: así puede distinguir entre lo que el servicio pidió y lo que el actuador realmente hizo. Si se ordenó encender (`on` o `1`) pero `/estado` sigue apagado (`off` o `0`), la orden está pendiente; si pasa un tiempo y no cambia, el actuador falló o el ESP32 no la recibió. Con solo el estado, el usuario no sabría que hubo una orden. El servicio le pasa las dos cosas por actuador (`ordenado` y `real`), y la web marca "pendiente" cuando no coinciden.
- **La web recibe los datos a través del servicio** (Server-Sent Events) en vez de conectarse al broker por WebSocket:
  - con TLS, un navegador solo acepta el certificado del broker si se le instala la CA del proyecto; el servicio la usa directamente desde el archivo;
  - las claves MQTT no quedan en el código de la página;
  - las lecturas no son retenidas, pero el servicio guarda la última de cada sensor y se la manda a la web apenas se abre, sin esperar a la próxima;
  - el control manual o el historial se pueden sumar después como pedidos al servicio, y las órdenes siguen saliendo solo de él.
- **El servicio reenvía las órdenes cuando el nodo se conecta:** como `/cmd` no es retenido y el ESP32 no recuerda las órdenes al reiniciarse, cada vez que un nodo publica `online` en `{nodoId}/presencia` el servicio le vuelve a mandar las órdenes vigentes.
- **Presencia con Last Will:** sin este tópico, si un ESP32 se corta el servicio y el usuario solo verían que dejan de llegar lecturas, sin saber si el nodo murió o simplemente no cambió nada. Con el Last Will el broker avisa en nombre del ESP32 aunque este no haya podido despedirse.
- **Las alertas las genera el broker**, no el usuario ni cada ESP32: la lógica de cuándo algo es una alerta queda en un solo lugar y todos los usuarios ven las mismas alertas. Se hacen en el motor de reglas, y no en el servicio, por dos razones:
  - la alerta "servicio caído" no la puede publicar el propio servicio;
  - las alertas de hoy no necesitan recordar nada entre mensajes: cada `offline` u `online` alcanza para decidir.

  Una alerta que necesite estado (por ejemplo, "humedad baja durante más de 10 minutos") tendría que generarla el servicio, en `alertas/{tipo}/{nodoId}`, con la ACL de publicación correspondiente.
