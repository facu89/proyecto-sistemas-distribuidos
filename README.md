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
| Ventilador | `temperatura_aire` ≥ 28 °C | `temperatura_aire` < 26 °C |

## Pendientes

### Firmware y actuadores
- [ ] Conectar los actuadores reales (relés de luz, ventilador y riego) y que el ESP32 publique el estado real en `{nodoId}/actuador/{tipo}/estado` (QoS 1, retenido). El servicio y la web ya lo esperan: la web va a mostrar "pendiente" mientras la orden y el estado no coincidan.
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
- [ ] Definir los tipos de alerta (`alertas/{tipoAlerta}`) y si van retenidos (está abierto en `topics.md`). Que el servicio las publique y se las pase a la web.
- [ ] Control manual desde la web: `POST` al servicio, que publica la orden. Hay que definir cuánto dura una orden manual frente a las reglas automáticas.
- [ ] Ajustar los umbrales con el uso (por ejemplo, el apagado del ventilador en 26 °C). Se cambian en `software/servicio/.env` sin tocar el código.
- [ ] Varios bancales: selector de nodo en la web (hoy se elige con `?nodo=`) y un usuario MQTT por ESP32.
