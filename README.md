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
| `software/simulador/` | ESP32 simulado (`bancal2esp1`): un segundo bancal que corre en la computadora, con panel web | [README](software/simulador/README.md) |
| `diseño_pagina_web/` | Modelo 3D (Blender) y la web (Vite + React + Three.js) | [PLAN](diseño_pagina_web/PLAN.md), [README de la web](diseño_pagina_web/web/README.md) |

## Puesta en marcha

Los comandos son de bash (en Windows, Git Bash) y se corren desde la raíz del repo. Las claves y las claves privadas no están en el repo: se generan o se completan en archivos que git ignora (`secrets/`, `security/certs/`, `config.h`, `.env`).

### 1. Lado servidor: broker, MySQL, servicio y web

Solo hace falta Docker (o Podman). Los certificados, la base y la web se arman en contenedores.

```bash
cd software/broker
cp -r secrets.example secrets
# Completar secrets/.env y secrets/servicio.env: claves largas en cada línea (openssl rand -hex 24) y
# BROKER_IP = la IP de esta máquina en la red de los ESP32 (va en el certificado TLS del broker).
docker compose up -d        # la primera vez tarda unos minutos: baja imágenes y compila la web
docker compose ps           # emqx, mysql y servicio "Up"; certs y mysql-actualizar "Exited (0)"
```

Queda:
- **Web:** http://localhost:8080
- **MQTT con TLS mutuo:** puerto 8883
- **Panel de EMQX:** http://localhost:18083

Para apagar: `docker compose down` (sin `-v`, así no se borran la base ni el historial). Más detalles, en el [README del broker](software/broker/README.md#cómo-se-levanta).

**En el servidor de la cátedra** (`alumno16`), desde tu máquina y con los cambios commiteados: `software/broker/desplegar.sh`. Sube el commit actual por SSH y lo levanta con el mismo compose. La primera vez y los detalles están en la [sección "Servidor"](software/broker/README.md#servidor).

### 2. Clientes

Cada cliente MQTT necesita tres cosas: un usuario con su clave en MySQL, un certificado de cliente con ese usuario como CN y el client ID igual al usuario. El `docker compose up` crea los de `bancal1esp1` (la placa) y `bancal2esp1` (el simulador) a partir de `secrets/.env`.

**ESP32 real (`bancal1esp1`)**, con PlatformIO:

```bash
cd firmware
cp include/config.example.h include/config.h
# En config.h: WIFI_SSID y WIFI_PASS; MQTT_HOST = BROKER_IP y MQTT_PORT = 8883 (en el servidor:
# "bancal.taile538b8.ts.net" y 443); NODO_ID = "bancal1esp1"; MQTT_PASS = MQTT_ESP_PASSWORD de secrets/.env
pio run -t upload           # embebe la CA y el certificado de cliente del nodo (de software/broker/security/certs)
pio device monitor          # opcional: ver el log por el puerto serie
```

**ESP32 simulado (`bancal2esp1`)**: un segundo bancal que corre en la computadora, sin placa. Se conecta al broker igual que el ESP32 (TLS mutuo, mismos tópicos y mismas reglas) y aparece en la web como otro bancal. Necesita Node 22.18 o más nuevo y pnpm.

```bash
cd software/simulador
cp .env.example .env
# En .env: MQTT_PASSWORD = MQTT_SIMULADOR_PASSWORD de secrets/.env. MQTT_URL apunta al servidor por defecto;
# para el broker local: MQTT_URL=mqtts://localhost:8883
pnpm install
pnpm start                  # panel del simulador en http://localhost:8091
```

Desde el panel se puede fijar el valor de un sensor y desconectarlo de golpe (el broker publica el Last Will). También se puede probar la conexión sin certificado o sin contraseña, para ver que el broker la rechaza. Ver el [README del simulador](software/simulador/README.md).

**Cliente de prueba (`cliente_web`, solo lectura)**, con `mosquitto_sub`, para mirar los mensajes:

```bash
software/broker/security/generar_cliente.sh cliente_web     # su certificado (necesita openssl)
cd software/broker/security/certs
mosquitto_sub -h localhost -p 8883 --cafile ca.pem \
  --cert clientes/cliente_web.pem --key clientes/cliente_web.key \
  -i cliente_web -u cliente_web -P '<MQTT_WEB_PASSWORD de secrets/.env>' \
  -t '+/sensor/+' -t '+/presencia' -t '+/actuador/+/estado' -t 'alertas/#' -v
```

Si se usa otro client ID, otro usuario o se saca el certificado, el broker rechaza la conexión. Si un cliente se suscribe o publica en un tópico que la ACL no le permite, EMQX lo rechaza. Para el servidor: `-h bancal.taile538b8.ts.net -p 443`, con la clave de `cliente_web` del servidor.

Si la máquina del broker cambia de red o de IP, hay que cambiar `BROKER_IP`, volver a hacer `docker compose up -d` (o correr `software/broker/levantar.sh`, que detecta las IPs solo) y actualizar `MQTT_HOST` en el ESP32 (ver el [README del broker](software/broker/README.md#si-cambia-la-red-o-la-ip-de-la-máquina)).

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
