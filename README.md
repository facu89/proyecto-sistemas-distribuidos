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

**En el servidor de la cátedra** (`alumno16`): con los cambios commiteados, `software/broker/desplegar.sh` sube el commit actual por SSH y levanta todo con Docker Compose. La primera vez y los detalles están en el [README del broker, sección "Servidor"](software/broker/README.md#servidor).

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
- [x] Relé del riego (bomba): funciona. Si la humedad del suelo marca 100 % fijo es porque el sensor está puenteado (se hizo para no activar la bomba en las pruebas): sacar el puente para que el riego automático actúe.
- [ ] Resolver la IP del broker por nombre (mDNS, por ejemplo `broker.local`) en vez de fijarla en `config.h`. Así no habría que volver a grabar el ESP32 al cambiar de red. El certificado tendría que incluir ese nombre.

- [x] **Las reglas corren en el ESP32** (`firmware/src/reglas.c`): sigue funcionando aunque se caiga el servicio, el broker o internet. El servicio le manda modo y rangos en `{nodoId}/config` (retenido), que el ESP32 guarda en NVS. En manual, si pierde el servicio, pasa a automático en el acto. Ver [topics.md](software/broker/topics.md), sección 6.
- [x] **Reglas del ESP32 probadas con la placa** contra el servidor: orden manual, paso a automático al reiniciar el servicio (apagó la luz porque había luz) y vuelta a manual, y rangos nuevos del cooler aplicados al instante. Faltan el horario de la luz (de noche) y el riego por pulsos con agua.
- [x] **Sonda de suelo calibrada:** `SUELO_SECO = 450` (al aire) y `SUELO_MOJADO = 2800` (empapada).
- [x] **Riego por pulsos:** 5 s de bomba y 2 lecturas (≈10 s) de espera, en automático y en manual. Se cambian desde la web (editor del riego) sin regrabar la placa.
- [ ] **Probar el caudal** para ajustar el pulso (¿5 s es la cantidad de agua adecuada?) y la espera (¿10 s alcanzan para que el agua llegue al sensor, o en automático riega de más?).

### Broker y seguridad
- [x] MQTT sin cifrar (1883) y WebSocket (8083 y 8084) apagados en `emqx.conf`; en local, el panel (18083) y la web (8080) solo desde la misma máquina.
- [x] **Servidor accesible desde cualquier red** (`alumno16`): la web por HTTPS solo para el grupo (`tailscale serve`) y el ESP32 por un único puerto público (`tailscale funnel`). Ver [Servidor](software/broker/README.md#servidor).
- [ ] **Borrar `software/broker/separar_secretos.sh`** cuando lo hayan corrido todos (cada integrante y el servidor): es una migración de una sola vez. Hay que sacar también su llamada en `desplegar.sh` y la mención en el README del broker, y borrar las copias `secrets/.env.antes-de-separar` (tienen claves) una vez comprobado que todo anda.
- [ ] **Renovación automática en el servidor:** la CA ya se renueva sola (10 años, misma clave) y el broker y el servicio también, pero solo en un `compose up`. Falta un `cron` mensual en el servidor que lo corra (ver [Vencimientos](software/broker/README.md#vencimientos-y-renovación)).
- [x] TLS mutuo en el puerto MQTT: el ESP32 y el servicio presentan un certificado de cliente firmado por nuestra CA, y su CN es el usuario MQTT (ver [TLS mutuo](software/broker/README.md#tls-mutuo-certificado-de-cliente)).
- [ ] Encriptación de la flash del ESP32, para que la clave privada del certificado no se pueda leer teniendo la placa.

### Motor de reglas de EMQX (*Rule Engine*)
Son consultas tipo SQL sobre los mensajes, con acciones: republicar, escribir en una base o llamar a un webhook. No reemplazan las reglas del servicio, porque la histéresis necesita recordar el estado anterior y el motor evalúa cada mensaje por separado. Sirven para:
- [x] **Historial:** la regla `guardar_historial` guarda en MySQL (`historial_lecturas`) una lectura por sensor cada 10 minutos, hasta 14 días, sin pasar por el servicio. Se ve en el dashboard de la web. Borra solo las lecturas de más de 14 días (antes vaciaba la tabla entera).
- [ ] **Filtrar en el broker** lecturas inválidas (`nan` o fuera de rango) antes de que lleguen a los suscriptores. De paso, la regla `guardar_historial` intenta convertir `nan` a número antes de filtrarlo y deja una advertencia en el log de EMQX (no guarda nada mal, pero ensucia).
- [x] **Alertas simples** sin estado: `alertas/nodo_offline/{nodoId}` y `alertas/servicio` (ver abajo).

### Webhooks de EMQX
EMQX hace un HTTP POST por cada mensaje o evento que elijamos. Sirve cuando del otro lado hay algo que solo habla HTTP:
- [x] **Telegram en el servidor:** avisa cuando se cae o vuelve el servicio (regla `vigilar_servicio`, directo desde EMQX) y cuando se conecta o desconecta un ESP32.
- [ ] **Aviso si se cae el servidor entero:** ahí EMQX también está caído y no puede avisar. Un monitor externo gratuito (por ejemplo UptimeRobot) que pruebe `bancal.taile538b8.ts.net:443` cada 5 minutos y avise por Telegram o mail.
- [ ] **Webhook de conexiones en el servidor:** generar `WEBHOOK_TOKEN` en `secrets/servicio.env` y el mismo en `EMQX_CONNECTORS__HTTP__SERVICIO__HEADERS` de `secrets/.env`, y desplegar. Sin eso el webhook queda desactivado (el resto anda igual).
- [ ] **Eventos del broker** (cliente conectado o desconectado, autenticación fallida) hacia un sistema de monitoreo o auditoría.

### Servicio y alertas
- [x] Alertas `alertas/nodo_offline/{nodoId}` y `alertas/servicio` (retenidas, las publica el motor de reglas de EMQX). El servicio se suscribe a `alertas/#` y se las pasa a la web en la instantánea.
- Descartado: mostrar las alertas en la web. La caída de un ESP32 ya se ve por su presencia (Last Will), y si se cae el servicio la web directamente no carga.
- [x] Modo automático / manual desde la web: en manual, los interruptores del panel le piden la orden al servicio (ver [README del servicio](software/servicio/README.md#modo-automático--manual)).
- [x] **Rangos por bancal desde la web:** riego, cooler y horario opcional de la luz; se guardan en MySQL (ver [README del servicio](software/servicio/README.md#rangos-por-bancal)).
- [x] **Dashboard del historial:** botón **▲ Historial** en la web. Gráficos tiempo/magnitud y una tabla por sensor, con los datos de `historial_lecturas` que el servicio lee con un usuario de MySQL de solo lectura (ver [PLAN de la web](diseño_pagina_web/PLAN.md), Fase 6).
- [x] El contenedor del servicio recibe solo sus claves (`secrets/servicio.env`), no todo `secrets/.env` (ver [Secretos](software/broker/README.md#secretos-quién-ve-qué)).
- [x] El modo de cada bancal se guarda en MySQL y sobrevive a un reinicio del servicio.
- [ ] **Usuarios en la web:** hoy cualquiera que pueda abrirla puede cambiar el modo y manejar los actuadores. Hace falta antes de abrir el servicio a la red (`HTTP_HOST=0.0.0.0`).
- [x] Varios bancales: botón "Vivero" abajo al centro de la web que despliega los bancales, con el estado de cada nodo (en línea / caído).
- [x] **Segundo bancal simulado** (`software/simulador`): `bancal2esp1` corre en una computadora y se conecta al servidor por MQTT como la placa (TLS mutuo, mismas reglas). Así hay dos bancales en la web, uno real y uno simulado.
