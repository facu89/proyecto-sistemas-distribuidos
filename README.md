# Sistema de bancales

Proyecto de Sistemas Distribuidos (UNPSJB). Cada bancal tiene un ESP32 que lee sensores y maneja actuadores. Un servicio central decide cuándo actuar y una web muestra el estado en una escena 3D. Todo se comunica por MQTT sobre TLS a través de un broker EMQX.

```
ESP32 ──MQTT/TLS──► EMQX ◄──MQTT/TLS──► Servicio ──HTTP + SSE──► Navegador (web 3D)
(sensores y          (broker,           (reglas: publica          (solo muestra)
 actuadores)          ACL en MySQL)      las órdenes)
```

| Carpeta | Qué hay | Documentación |
|---|---|---|
| `firmware/` | ESP32 (Heltec WiFi LoRa 32 V3, PlatformIO): sensores, pantalla y MQTT por TLS | `firmware/include/config.example.h` |
| `software/broker/` | EMQX + MySQL (usuarios y ACL), certificados TLS | [README](software/broker/README.md), [tópicos](software/broker/topics.md) |
| `software/servicio/` | Reglas de los actuadores y servidor de la web | [README](software/servicio/README.md) |
| `diseño_pagina_web/` | Modelo 3D (Blender) y la web (Vite + React + Three.js) | [PLAN](diseño_pagina_web/PLAN.md), [README de la web](diseño_pagina_web/web/README.md) |

## Puesta en marcha

```bash
# 1. Broker (la primera vez: cp -r secrets.example secrets y completar secrets/.env)
software/broker/levantar.sh          # revisa el certificado TLS y levanta EMQX + MySQL (Podman o Docker)

# 2. Web: compilarla una vez (y cada vez que se modifique)
cd diseño_pagina_web/web && pnpm install && pnpm build

# 3. Servicio: reglas + web en http://localhost:8080
cd software/servicio && pnpm install && pnpm start

# 4. ESP32: en firmware/include/config.h, MQTT_HOST = la IP que muestra levantar.sh y MQTT_PORT = 8883.
#    Compilar y grabar con PlatformIO (la CA del broker se embebe sola).
```

Si la máquina del broker cambia de red o de IP, hay que volver a correr `levantar.sh` y actualizar `MQTT_HOST` en el ESP32 (ver [README del broker](software/broker/README.md#si-cambia-la-red-o-la-ip-de-la-máquina)).

## Reglas de los actuadores

Las aplica el servicio ([`software/servicio/src/reglas.ts`](software/servicio/src/reglas.ts)):

| Actuador | Se prende | Se apaga |
|---|---|---|
| Luz | a oscuras (`luz` = 0) | con luz (`luz` = 1) |
| Riego | `humedad_suelo` < 20 % | `humedad_suelo` ≥ 70 % |
| Cooler (ventilador) | `temperatura_aire` ≥ 28 °C | `temperatura_aire` < 26 °C |

## Pendientes

### Firmware y actuadores
- [x] Actuadores reales en el ESP32 (relés de luz y cooler) que publican el estado real en `{nodoId}/actuador/{tipo}/estado` (`1`/`0`, retenido). La web muestra "pendiente" mientras la orden y el estado no coinciden.
- [ ] Relé del riego (bomba): está en curso en `pines.h` y `actuadores.cpp`.
- [ ] Resolver la IP del broker por nombre (mDNS, por ejemplo `broker.local`) en vez de fijarla en `config.h`. Así no habría que volver a grabar el ESP32 al cambiar de red. El certificado tendría que incluir ese nombre.

### Broker y seguridad
- [ ] Cerrar los puertos sin cifrar (1883 y 8083) cuando todos los clientes usen TLS.
- [ ] Servir la web por HTTPS si se va a abrir desde otros equipos: un certificado para el servicio firmado por la misma CA, que cada navegador tendría que tener instalada.

### Motor de reglas de EMQX (*Rule Engine*)
Son consultas tipo SQL sobre los mensajes, con acciones: republicar, escribir en una base o llamar a un webhook. No reemplazan las reglas del servicio, porque la histéresis necesita recordar el estado anterior y el motor evalúa cada mensaje por separado. Sirven para:
- [ ] **Historial:** guardar cada lectura en MySQL (`SELECT ... FROM "+/sensor/+"` hacia una tabla de lecturas), sin pasar por el servicio. Después la web podría mostrar gráficos.
- [ ] **Filtrar en el broker** lecturas inválidas (`nan` o fuera de rango) antes de que lleguen a los suscriptores.
- [ ] **Alertas simples** sin estado, por ejemplo republicar en `alertas/nodo_offline` cuando llega `offline` en `+/presencia`.

### Webhooks de EMQX
EMQX hace un HTTP POST por cada mensaje o evento que elijamos. Sirve cuando del otro lado hay algo que solo habla HTTP:
- [ ] **Notificaciones:** mandar `alertas/#` a Telegram, Discord o un mail mediante su API HTTP.
- [ ] **Eventos del broker** (cliente conectado o desconectado, autenticación fallida) hacia un sistema de monitoreo o auditoría.

### Servicio y alertas
- [x] Alertas `alertas/nodo_offline/{nodoId}` y `alertas/servicio` (retenidas, las publica el motor de reglas de EMQX). El servicio se suscribe a `alertas/#` y se las pasa a la web en la instantánea.
- [ ] Mostrar las alertas en la web (hoy llegan por SSE pero el panel no las dibuja).
- [x] Modo automático / manual desde la web: en manual, los interruptores del panel le piden la orden al servicio (ver [README del servicio](software/servicio/README.md#modo-automático--manual)).
- [ ] **Modificar los rangos desde la web:** editar en el panel los umbrales del riego (20 % / 70 %) y del cooler (28 °C / 26 °C). Hoy solo se cambian en `software/servicio/.env` y reiniciando el servicio. Habría que validarlos y guardarlos (por ejemplo, en un JSON o en MySQL) para que sobrevivan a un reinicio.
- [ ] Guardar el modo de cada nodo: hoy vive en memoria y al reiniciar el servicio todos vuelven a automático.
- [ ] **Usuarios en la web:** hoy cualquiera que pueda abrirla puede cambiar el modo y manejar los actuadores. Hace falta antes de abrir el servicio a la red (`HTTP_HOST=0.0.0.0`).
- [x] Varios bancales: botón "Vivero" abajo al centro de la web que despliega los bancales, con el estado de cada nodo (en línea / caído).
- [ ] Un usuario MQTT por ESP32 (para sumar bancales reales).
