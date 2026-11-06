# Diseño de tópicos

Todos los tópicos van en minúscula (MQTT distingue mayúsculas: `Actuador` y `actuador` son tópicos distintos).
Lo que está entre llaves `{}` es una parte variable del tópico; el resto es fijo.

- `{nodoId}` identifica al nodo. Hay un solo ESP32 por bancal, así que el nodo es el bancal junto con su ESP32. Es **un solo nivel** del tópico. Ejemplo: `bancal1esp1`.
- `{tipo}` es el nombre del componente (`riego`, `luz`, `temperatura`, `humedad`...). Es un solo nivel, así que hay un solo componente de cada tipo por nodo. Ejemplo: `riego`.

Participantes:

- **ESP32:** lee los sensores y maneja los actuadores de su nodo.
- **Servicio** ([`software/servicio`](../servicio/README.md)): recibe las lecturas, decide cuándo actuar y genera las alertas.
- **Usuario:** la interfaz que ve una persona (la web, [`diseño_pagina_web/web`](../../diseño_pagina_web/web/README.md)). Solo lee. **No se conecta al broker:** recibe del servicio, por HTTP con Server-Sent Events (`/api/eventos`), lo mismo que le llega por estos tópicos. Ver "La web recibe los datos a través del servicio" en las decisiones de diseño.

Todos se conectan al broker por TLS (puerto 8883), verificando el certificado del broker con la CA del proyecto (ver [`README.md`](README.md)).

## Resumen

| Tópico | Nombre | Publica | Se suscriben | QoS | Retain |
|---|---|---|---|---|---|
| `{nodoId}/actuador/{tipo}/cmd` | Activar | Servicio | ESP32 (solo su nodo) y Usuario | 1 | No |
| `{nodoId}/actuador/{tipo}/estado` | Estado del actuador | ESP32 | Usuario y Servicio | 1 | Sí |
| `{nodoId}/sensor/{tipo}` | Lectura de sensor | ESP32 | Usuario y Servicio | 0 | No |
| `{nodoId}/presencia` | Presencia | ESP32 (`online`) / broker por Last Will (`offline`) | Usuario y Servicio | 1 | Sí |
| `alertas/{tipoAlerta}` | Alertas | Servicio | Usuario | 1 | A definir |

Filtros de suscripción de cada participante:

| Participante | Filtros |
|---|---|
| ESP32 | `{nodoId}/actuador/+/cmd` (solo los de su propio nodo) |
| Servicio | `+/sensor/+`, `+/actuador/+/estado`, `+/presencia` |
| Usuario | Ninguno: no se conecta al broker. El servicio le pasa las lecturas, las órdenes que dio, el estado de los actuadores y la presencia. Las alertas se van a pasar igual cuando existan. |

La tabla de resumen dice "Usuario" en *Se suscriben* porque recibe esos datos, aunque le lleguen a través del servicio. En la ACL quedó el usuario MQTT `cliente_web`, de solo lectura, por si más adelante se quiere un cliente que lea directo del broker (por ejemplo, para depurar).

`+` reemplaza exactamente un nivel ("cualquier nodo", "cualquier tipo") y `#` reemplaza todos los niveles que siguen.

## Detalle

### 1. Activar (actuadores)

`{nodoId}/actuador/{tipo}/cmd`

Ejemplo: `bancal1esp1/actuador/riego/cmd`, con payload `on` u `off`.

- **Publica:** solo el servicio, cuando decide activar o desactivar algo.
- **Se suscribe el ESP32:** solo a los actuadores de su nodo, con `{nodoId}/actuador/+/cmd`. Ver "Comando en `/cmd`" en las decisiones de diseño.
- **Se suscribe el usuario:** para ver qué ordenó el servicio. Ver "El usuario escucha las órdenes" en las decisiones de diseño.
- **QoS 1:** una orden perdida puede ser grave (por ejemplo, el servicio envía `off` al riego, se pierde y la planta se inunda). Si llega dos veces no pasa nada: `on` u `off` repetido deja el mismo resultado (la orden es idempotente). Por eso no hace falta QoS 2.
- **Retain no:** si la orden quedara retenida, el ESP32 la recibiría y la volvería a ejecutar cada vez que se reconecta.

### 2. Estado del actuador

`{nodoId}/actuador/{tipo}/estado`

Ejemplo: `bancal1esp1/actuador/riego/estado`, con payload `on` u `off`.

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

`alertas/{tipoAlerta}`

> Los tipos de alerta todavía no están definidos.

- **Publica:** solo el servicio, a partir de las lecturas de los sensores, del estado de los actuadores y de la presencia de los nodos.
- **Se suscribe:** el usuario, con `alertas/#`.
- **QoS 1:** una alerta perdida es una alerta que nadie ve.
- **Retain:** a definir junto con los tipos de alerta. Si una alerta representa un estado que se mantiene ("humedad baja" activa hasta que se resuelve), conviene retenerla; si es un evento puntual, no.

## Decisiones de diseño

- **Un tópico por sensor** (en vez de un solo mensaje con todos los datos): el payload es solo un número, se puede suscribir a una sola magnitud y las reglas por umbral (por ejemplo, humedad baja) quedan simples.
- **Separación `sensor` / `actuador`:** permite que la ACL diga claramente "el ESP32 publica en `sensor` y en `actuador/.../estado`, y lee `actuador/.../cmd`; el servicio, al revés".
- **`{nodoId}` de un solo nivel, igual al usuario MQTT del ESP32:** cada ESP32 se autentica en el broker con su `{nodoId}` como usuario. Así la ACL se escribe con una única regla genérica para todos los nodos ("cada ESP32 solo publica y lee tópicos que empiezan con su propio `{nodoId}`"), sin cargar una regla por equipo, y ningún ESP32 puede publicar datos en nombre de otro nodo.
- **Comando en `/cmd` y estado en `/estado`:** el comando y el estado de un actuador son dos subtópicos hermanos, al mismo nivel (`.../riego/cmd` y `.../riego/estado`). Si el comando fuera el propio `.../riego` y el estado un subtópico suyo, el ESP32 tendría que suscribirse con un filtro exacto de un nivel (`{nodoId}/actuador/+`) y cuidarse de no usar nunca `#`, porque recibiría sus propios mensajes de `/estado` como si fueran órdenes y podría entrar en un bucle (publica `on` como estado, lo lee como orden, lo vuelve a ejecutar). Con `/cmd` el ESP32 se suscribe solo a lo que termina en `cmd`, no hay forma de confundir una cosa con la otra, y la ACL queda simple: el ESP32 lee `.../cmd` y publica `.../estado`; el servicio, al revés.
- **Las órdenes las da solo el servicio:** el usuario solo lee. Así nadie puede activar un actuador sin pasar por el servicio.
- **El usuario ve las órdenes**, no solo el estado: así puede distinguir entre lo que el servicio pidió y lo que el actuador realmente hizo. Si se ordenó `on` pero `/estado` sigue en `off`, la orden está pendiente; si pasa un tiempo y no cambia, el actuador falló o el ESP32 no la recibió. Con solo el estado, el usuario no sabría que hubo una orden. El servicio le pasa las dos cosas por actuador (`ordenado` y `real`), y la web marca "pendiente" cuando no coinciden.
- **La web recibe los datos a través del servicio** (Server-Sent Events) en vez de conectarse al broker por WebSocket:
  - con TLS, un navegador solo acepta el certificado del broker si se le instala la CA del proyecto; el servicio la usa directamente desde el archivo;
  - las claves MQTT no quedan en el código de la página;
  - las lecturas no son retenidas, pero el servicio guarda la última de cada sensor y se la manda a la web apenas se abre, sin esperar a la próxima;
  - el control manual o el historial se pueden sumar después como pedidos al servicio, y las órdenes siguen saliendo solo de él.
- **El servicio reenvía las órdenes cuando el nodo se conecta:** como `/cmd` no es retenido y el ESP32 no recuerda las órdenes al reiniciarse, cada vez que un nodo publica `online` en `{nodoId}/presencia` el servicio le vuelve a mandar las órdenes vigentes.
- **Presencia con Last Will:** sin este tópico, si un ESP32 se corta el servicio y el usuario solo verían que dejan de llegar lecturas, sin saber si el nodo murió o simplemente no cambió nada. Con el Last Will el broker avisa en nombre del ESP32 aunque este no haya podido despedirse.
- **Las alertas las genera el servicio**, no el usuario: la lógica de cuándo algo es una alerta queda en un solo lugar y todos los usuarios ven las mismas alertas.
