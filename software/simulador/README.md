# ESP32 simulado

Un segundo bancal (`bancal2esp1`) que corre en una computadora y se conecta al broker **igual que la placa**: MQTT con TLS mutuo (certificado de cliente), client ID igual al usuario, los mismos tópicos y las mismas reglas. Así hay dos bancales en la web, uno real y uno simulado, y se puede probar sin tocar los relés ni la bomba.

## Qué hace

- **Sensores:** cada 5 s publica lecturas en `bancal2esp1/sensor/{tipo}`, con valores que cambian con la hora y responden a los actuadores (`src/modelo.ts`):

  | Sensor | Comportamiento |
  |---|---|
  | Temperatura del aire | Sube de día y baja de noche: de ~18 °C de madrugada a ~31 °C a la tarde. El cooler la baja unos 4 °C |
  | Humedad del suelo | Se seca de a poco (de 70 % a ~40 % en una hora). Cada segundo de riego suma 1,5 puntos |
  | Luz | Hay luz de 7:00 a 19:30 (la lámpara no cuenta) |

- **Reglas:** las aplica él mismo, como la placa (`src/bancal.ts`):
  - **Origen de las reglas:** son las de `software/servicio/src/reglas.ts`, las mismas que `firmware/src/reglas.c`. Usan la configuración que publica el servicio en `bancal2esp1/config`.
  - **Riego por pulsos:** igual que en la placa.
  - **Manual:** obedece las órdenes de la web.
  - **Sin servicio:** pasa a automático.
- **Configuración guardada:** la última que recibió queda en `estado.json`, que hace de memoria NVS. Si arranca sin broker, sigue con esa.
- **Presencia:** publica `online` al conectarse. Si se corta, el broker publica `offline` (Last Will), igual que con la placa.

## Cómo se corre

1. **El usuario y el certificado** los crea el broker si `secrets/.env` tiene `MQTT_SIMULADOR_USER` y `MQTT_SIMULADOR_PASSWORD`:
   - el usuario MQTT lo crea `mysql-actualizar` en cada `compose up`;
   - el certificado de cliente lo genera el contenedor `certs`, o a mano con `software/broker/security/generar_cliente.sh bancal2esp1`.
2. **Configuración:** `cp .env.example .env` y poner en `MQTT_PASSWORD` la clave de `MQTT_SIMULADOR_PASSWORD` **del broker al que se conecta**. Por defecto se conecta al servidor: `mqtts://bancal.taile538b8.ts.net:443`.
3. **Arrancar:** `pnpm install` y `pnpm start`. Se corta con Ctrl+C, y al cerrar publica `offline`.

Como usa el mismo certificado de cliente que generó tu broker local, firmado por la misma CA que el servidor, sirve contra los dos.

## Pruebas

`pnpm test` prueba:
- la configuración;
- los pulsos de riego;
- el paso a automático sin servicio;
- el modelo de los sensores.
