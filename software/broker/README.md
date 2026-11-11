# Broker (EMQX + MySQL)

EMQX es el broker MQTT; MySQL guarda los usuarios (`mqtt_user`), sus permisos (`mqtt_acl`) y el historial de lecturas (`historial_lecturas`: una lectura por sensor cada 10 minutos, se borra lo de más de 14 días; lo llena la regla `guardar_historial` de `config/emqx.conf`). Los tópicos y quién publica en cada uno están en [`topics.md`](topics.md).

## Cómo se levanta

Solo hace falta Docker (o Podman). No hay que instalar Node, pnpm ni OpenSSL: todo se genera en contenedores.

```bash
cd software/broker
cp -r secrets.example secrets   # la primera vez: completar secrets/.env (BROKER_IP incluida) y secrets/servicio.env
docker compose up -d            # o: podman compose up -d
```

Levanta cuatro contenedores, en orden:

| Contenedor | Qué hace |
|---|---|
| `certs` | Corre y termina. Deja listo el certificado TLS del broker en `security/certs` y solo lo regenera si hace falta (ver [TLS](#tls-certificados)). |
| `mysql` | Usuarios, ACL e historial de lecturas. |
| `mysql-actualizar` | Corre y termina. Pone al día una base que ya tiene datos, **sin borrar nada** (ver abajo). |
| `emqx` | El broker. Arranca cuando `certs` terminó bien y MySQL está listo. |
| `servicio` | El [servicio central](../servicio/README.md): reglas de los actuadores, la web en **http://localhost:8080** y el historial; guarda el modo y los rangos de cada bancal (usuario `servicio` de MySQL). Su imagen también compila la web. Arranca cuando EMQX está listo y `mysql-actualizar` terminó. |

La primera vez tarda porque baja las imágenes y compila la web; después arranca en segundos. Si se cambia el código del servicio o de la web, hay que reconstruir la imagen: `docker compose up -d --build`.

Comandos útiles: `docker compose ps` (estado), `docker compose logs -f servicio` (logs), `docker compose down` (apagar).

### Cambios en la base sin perder el historial

MySQL corre `mysql/init.sql` y `mysql/02-init-users.sh` **solo cuando el volumen está vacío**. Para que un cambio en esos archivos o en `secrets/.env` no obligue a borrar todo, en cada `compose up` el contenedor `mysql-actualizar` corre `mysql/actualizar.sh`, que:

1. **Vuelve a correr `init.sql`:** crea las tablas que falten y agrega los permisos nuevos. Todo es `CREATE TABLE IF NOT EXISTS` e `INSERT IGNORE`, así que lo que ya está queda igual.
2. **Vuelve a correr `02-init-users.sh`:** si cambió la clave de un usuario MQTT en `secrets/.env`, la actualiza.
3. **Crea o actualiza el usuario `servicio` de MySQL**, con la clave `MYSQL_SERVICIO_PASSWORD` (`secrets/servicio.env`). Solo puede leer `historial_lecturas` (el historial de la web) y leer y escribir `configuracion_nodo` (modo y rangos de cada bancal). Reemplaza al usuario `lector`, que solo leía, y lo borra.

**¿Por qué un usuario propio?** El servicio atiende pedidos de la web. Si alguna vez una consulta tuviera un error, con este usuario lo peor que puede pasar es leer el historial o cambiar la configuración de un bancal. Con el usuario `emqx` podría leer las claves (hash) de `mqtt_user`, cambiar los permisos o borrar el historial.

Tablas de la base:

| Tabla | Qué guarda | Quién escribe |
|---|---|---|
| `mqtt_user`, `mqtt_acl` | Usuarios MQTT y sus permisos | `init.sql` y `02-init-users.sh` |
| `historial_lecturas` | Una lectura por sensor cada 10 minutos, 14 días | La regla `guardar_historial` de EMQX |
| `configuracion_nodo` | Modo y rangos de cada bancal (`umbrales` en JSON; `NULL` = los de por defecto) | El servicio, cuando se cambian desde la web |

Si una tabla ya existente necesita **cambiar de forma** (una columna nueva, por ejemplo), `CREATE TABLE IF NOT EXISTS` no la toca: hay que agregar un `ALTER TABLE` a `actualizar.sh`. Para empezar de cero, igual que antes:

```bash
docker compose down -v   # borra los datos de EMQX y MySQL, incluido el historial
docker compose up -d
```

`levantar.sh` es la forma anterior, que corre en la máquina y detecta sola las IPs. Sigue funcionando, pero necesita bash y OpenSSL instalados.

> **Podman con SELinux (Fedora):** los montajes de `compose.yaml` llevan `,z` para que los contenedores puedan leer los archivos de la carpeta. Sin eso, EMQX no arranca (`emqx.conf is not found`) y MySQL no corre `init.sql` (`Permission denied`). En Docker sin SELinux, `,z` no hace nada.

## Secretos: quién ve qué

Las claves están en dos archivos de `secrets/`, y cada contenedor recibe solo los que necesita:

| Archivo | Qué tiene | Lo ven |
|---|---|---|
| `secrets/.env` | Root de MySQL, usuario `emqx`, panel y cookie de EMQX, usuarios MQTT del ESP32, `admin` y `cliente_web`, `BROKER_IP` y `BROKER_DNS` | `certs`, `mysql`, `mysql-actualizar`, `emqx` |
| `secrets/servicio.env` | Usuario y clave MQTT del servicio y la clave de su usuario de MySQL (`MYSQL_SERVICIO_PASSWORD`) | `servicio`, `mysql`, `mysql-actualizar` |

**¿Por qué el servicio tiene su propio archivo?** Es el contenedor que atiende la web: recibe pedidos de los navegadores y corre dependencias de npm. Si alguien encontrara una falla y pudiera ejecutar código ahí, leería todas las variables de entorno del proceso. Si el servicio viera todo `secrets/.env`, con eso tendría:

- **La clave de root de MySQL:** podría borrar el historial o los usuarios.
- **El usuario `admin` de MQTT, que es superusuario:** podría publicar órdenes a cualquier bancal.
- **La clave del ESP32:** podría hacerse pasar por él.
- **La cookie de EMQX:** permite controlar el broker entero.

Con su propio archivo, lo peor que obtiene es lo que el servicio ya puede hacer: sus tópicos MQTT y leer el historial. Además, las variables de entorno de un contenedor las ve cualquiera que corra `docker inspect`, y suelen terminar en logs o en reportes de errores.

`mysql` y `mysql-actualizar` leen los dos archivos porque crean esos usuarios. Así cada clave está **en un solo lugar** y no puede pasar que dos copias queden distintas (como pasó con la clave del conector del historial).

**Si ya tenías `secrets/` del formato anterior:** correr `./separar_secretos.sh` (se puede correr las veces que sea). Mueve las claves del servicio a `servicio.env`, renombra `MYSQL_LECTOR_PASSWORD` a `MYSQL_SERVICIO_PASSWORD`, genera esa clave si faltaba y deja una copia del `.env` anterior en `secrets/.env.antes-de-separar`. En el servidor lo corre solo `desplegar.sh`.

Se podría ir más lejos: que EMQX tampoco vea la clave de root ni las de los clientes, o pasar las claves como archivos ([secrets de Docker](https://docs.docker.com/compose/how-tos/use-secrets/)) en vez de variables de entorno. Hoy el que está expuesto a la web es el servicio, y por eso es el que más importa.

## Puertos

En la máquina de cada uno (`compose.yaml`):

| Puerto | Uso | Desde dónde |
|---|---|---|
| 8883 | MQTT sobre TLS: lo usan el ESP32 y el servicio | **La red**: el ESP32 se conecta a la IP de esta máquina |
| 18083 | Panel de EMQX (usuario y clave en `secrets/.env`) | Solo esta máquina (`http://localhost:18083`): es HTTP sin cifrar |
| 8080 | Web y API del servicio | Solo esta máquina (`http://localhost:8080`): la web no tiene login. Para verla desde el celular en la misma red, cambiar a `"8080:8080"` mientras se prueba |

**1883 (MQTT sin cifrar), 8083 (WebSocket) y 8084 (WebSocket con TLS)** vienen encendidos por defecto en EMQX. Están apagados en `config/emqx.conf` y no se publican: ningún cliente los usa, y abiertos dejarían entrar conexiones cuya clave viaja en texto plano. El 1883 y el 8083 quedaron abiertos de la primera versión, cuando todavía no se usaba TLS.

En el servidor los puertos son otros (ver [Servidor](#servidor)).

## TLS: certificados

Con `compose up`, el contenedor `certs` corre `security/preparar_certificados.sh`, que regenera el certificado del broker solo si no existe, no lo firmó la CA actual, no coincide con su clave, vence en menos de 30 días o no incluye alguna IP de `BROKER_IP` o algún nombre de `BROKER_DNS`. Desde adentro de un contenedor no se pueden ver las IPs de la máquina, por eso `BROKER_IP` va en `secrets/.env`. `BROKER_DNS` hace falta cuando el ESP32 se conecta por nombre, como en el [servidor](#servidor).

**Los certificados no están en git** (`security/certs/*.pem` está en `.gitignore`): cada máquina genera los suyos y tiene su propia CA. Así nadie pisa los del otro.

- Si no hay `ca.key` (por ejemplo, en un clon nuevo del repo), crea una CA nueva: el ESP32 se tiene que recompilar y grabar en esa máquina.
- Si está `ca.key` pero falta `ca.pem`, rearma `ca.pem` con la misma clave. El ESP32 ya grabado lo sigue aceptando, porque verifica la firma con esa clave.
- Si `ca.pem` y `ca.key` son de CAs distintas, falla con un mensaje (EMQX no arranca) en vez de adivinar cuál usar.

Los certificados los genera `security/generar_certificados.sh`:

- **CA** (`certs/ca.pem` y `certs/ca.key`): se crea solo si no existe. El firmware embebe `ca.pem` (la copia al compilar `firmware/scripts/copiar_certificados.py`) y el servicio la usa para verificar al broker. Ninguno de los dos archivos se sube a git.
- **Certificado del broker** (`certs/broker.pem` y `certs/broker.key`): firmado por la CA. Su SAN incluye `localhost`, `emqx`, `127.0.0.1` y las IPs de la máquina. Sin argumentos, el script las detecta solo (`security/ips_locales.sh`); también se le pueden pasar a mano IPs y nombres: `./generar_certificados.sh 192.168.1.50 bancal.taile538b8.ts.net`.

Si se regenera solo el certificado del broker, `ca.pem` no cambia y el firmware ya grabado sigue sirviendo. Para hacer una CA nueva hay que borrar `certs/ca.pem` y `certs/ca.key`, y después recompilar y grabar el ESP32.

### Si cambia la red o la IP de la máquina

El ESP32 verifica que la IP a la que se conecta (`MQTT_HOST`) figure en el certificado del broker. Si la máquina se conecta a otra red, o el router le asigna otra IP:

1. **Regenerar el certificado:** poner la IP nueva en `BROKER_IP` de `secrets/.env` y correr `docker compose up -d`. Como cambió `.env`, compose recrea los contenedores: `certs` regenera el certificado con la misma CA y EMQX arranca con el nuevo. (Con `./levantar.sh` la IP se detecta sola.)
2. **Actualizar el ESP32:** poner la IP nueva en `MQTT_HOST` de `firmware/include/config.h`, compilar y grabar. La CA no cambió, así que no hace falta nada más.
3. **El servicio** no necesita cambios, porque se conecta al broker por el nombre `emqx` dentro de la red de compose.
4. **Windows:** el firewall tiene que dejar entrar conexiones al puerto 8883 desde la red del ESP32 (si la red es "Pública", por defecto las bloquea).

Para que la IP no cambie, conviene reservarla en el router (DHCP estático) para la máquina del broker.

### Vencimientos y renovación

| Certificado | Dura | Se renueva |
|---|---|---|
| CA (`ca.pem`) | 10 años | En un `compose up`, si le queda menos de 1 año: con la **misma clave**, así lo ya firmado y el ESP32 grabado siguen sirviendo (guarda la anterior como `ca.pem.vencia-FECHA`) |
| Broker (`broker.pem`) | 1 año | En un `compose up`, si le quedan menos de 30 días |
| Cliente del servicio | 1 año | En un `compose up`, si le quedan menos de 30 días |
| Cliente de cada ESP32 | 10 años | Hay que generarlo de nuevo y volver a grabar la placa |

Las renovaciones solo ocurren cuando corre el contenedor `certs`, es decir, en cada `compose up` (o `desplegar.sh`). **El ESP32 no controla fechas** (su mbedTLS se compila sin `MBEDTLS_HAVE_TIME_DATE` y no sincroniza la hora): un certificado vencido no lo afecta a él, pero sí al servicio y a EMQX, que verifican las fechas.

**¿Por qué renovar la CA con la misma clave?** Los certificados identifican a la CA por su clave pública (extensión *Authority Key Identifier*), no por el archivo. Con la misma clave, todo lo firmado antes sigue validando y no hace falta tocar el ESP32. Cambiar de clave solo hace falta si se sospecha que `ca.key` se filtró; ahí hay que regrabar todos los ESP32.

### TLS mutuo (certificado de cliente)

El puerto 8883 exige que **el cliente también muestre un certificado** firmado por nuestra CA (`verify = verify_peer` y `fail_if_no_peer_cert = true` en `config/emqx.conf`). Sin certificado, la conexión se corta en el saludo TLS, antes de llegar a probar una clave. Como el puerto está publicado en internet en el servidor, eso deja afuera a cualquiera que no tenga un certificado nuestro.

- **Quién tiene certificado:** el servicio y cada ESP32 de `NODOS_TLS` (`secrets/.env`; por defecto, `MQTT_ESP_USER`). Los genera `security/generar_cliente.sh` en `security/certs/clientes/` (no van a git), en cada `compose up`.
- **El CN es el usuario:** con `mqtt.peer_cert_as_username = cn`, EMQX toma el usuario del certificado, no el que manda el cliente. El certificado de un ESP32 solo sirve para entrar como ese ESP32, y la clave se sigue pidiendo (contra MySQL): hacen falta las dos cosas.
- **El ESP32:** `firmware/scripts/copiar_certificados.py` copia al compilar la CA y el certificado y la **clave privada** de su `NODO_ID` a `firmware/certs/` (no va a git), y quedan embebidos en el binario. Se graba con `pio run -t upload`. La clave privada queda en la memoria flash de la placa: quien tenga la placa física puede leerla (para evitarlo está la encriptación de flash del ESP32, pendiente).
- **Un ESP32 nuevo:** agregar su nombre a `NODOS_TLS` (y su usuario a MySQL), `compose up` para que se genere el certificado, y compilar y grabar con ese `NODO_ID`.

### Cómo probarlo y mostrarlo

```bash
software/broker/probar_tls.sh            # contra el broker local
software/broker/probar_tls.sh servidor   # contra el servidor, por internet
```

Hace siete pruebas con `openssl`, solo el saludo TLS, sin iniciar sesión MQTT, así que no molesta al ESP32 ni al servicio:

1. El broker muestra un certificado firmado por nuestra CA y con el nombre correcto (TLS 1.3, AES-256-GCM).
2. Un cliente que no confía en nuestra CA lo rechaza.
3. Con otro nombre, también lo rechaza (así se frena a un intermediario).
4. Un cliente **sin certificado** queda afuera: el broker corta con `alert certificate required`.
5. Con un certificado nuestro, el broker lo acepta.
6. Un certificado de otra CA queda afuera (`bad certificate`).
7. (Solo local) 1883 y 8083 cerrados.

**Para mostrar que los datos viajan cifrados:** abrir Wireshark en la interfaz de la máquina del broker con el filtro `tcp.port == 8883`, y dejar que el ESP32 publique. Se ven el saludo TLS (*Client Hello*, *Server Hello*, *Certificate*) y después solo paquetes *Application Data* ilegibles: ni los tópicos, ni los valores, ni la clave MQTT aparecen en claro. Sin TLS, Wireshark decodificaría el MQTT y mostraría `bancal1esp1/sensor/temperatura_aire` y la clave del CONNECT.

## Servidor

Todo corre en `alumno16`, el nodo de la cátedra en `sd-2026`. Es un contenedor Debian con Docker, sin puertos abiertos a internet. Se entra por SSH a través de `sd-2026`, la máquina del profe compartida a nuestra red de Tailscale:

```bash
ssh -p 22116 alumno@100.117.231.80
```

`alumno16` tiene su propio Tailscale, en la red de Guido (`taile538b8.ts.net`), con el nombre **`bancal`**. Así se llega a cada cosa:

| Quién | Cómo | Dirección |
|---|---|---|
| El grupo (la web) | `tailscale serve`: HTTPS con certificado válido, **solo dentro de la red de Tailscale** | `https://bancal.taile538b8.ts.net:8443` |
| El ESP32 | `tailscale funnel`: **el único puerto público**, que pasa directo a EMQX | `bancal.taile538b8.ts.net:443` |
| Panel de EMQX | Túnel SSH, después abrir http://localhost:18083 | `ssh -L 18083:localhost:18084 -p 22116 alumno@100.117.231.80` |

En el servidor, `compose.servidor.yaml` deja todos los puertos de compose en `127.0.0.1` y **con otros números**:

| Puerto local | Qué | Quién llega |
|---|---|---|
| 8884 | MQTT con TLS (el 8883 de EMQX) | Funnel (`:443`) |
| 18084 | Panel de EMQX (el 18083) | Túnel SSH |
| 8090 | Web y API del servicio | `serve` (`:8443`) |

**¿Por qué otros números?** `sd-2026` reenvía sus puertos `183NN`, `188NN` y `181NN` a los 1883, 8883 y 18083 de cada nodo, y llega aunque el puerto esté atado a `127.0.0.1` (lo probamos: con el 8883 en `127.0.0.1`, el panel y el broker se veían desde `sd-2026:18116` y `:18816`). Seguramente los reenvíos se conectan desde adentro del contenedor. Con otros números esos reenvíos no encuentran nada, y nadie de la cátedra llega al broker ni al panel.

- **El 8080** lo usa el cebador de la clase 14, por eso el servicio va en el 8090.
- **1883 y 8083**, sin cifrar, no se publican.
- **Las otras máquinas de la red de la facultad** tampoco llegan, porque todo está en `127.0.0.1`.

> **Cuidado al probar:** no conectar clientes de prueba con los usuarios reales (`servicio`, `bancal1esp1`) mientras el ESP32 o el servicio estén conectados. EMQX desconecta al que tenía ese client ID, y los dos se pelean la conexión.

### Actualizar

Desde la máquina de cada uno, con los cambios commiteados:

```bash
software/broker/desplegar.sh
```

El script sube lo commiteado (HEAD) por SSH, sin usar GitHub, a `~/bancal` y corre `docker compose -f compose.yaml -f compose.servidor.yaml up -d --build`. Conserva `secrets/.env` y los certificados del servidor, y deja la versión anterior en `~/bancal.anterior`.

### Primera vez

1. **Tailscale en el servidor** (en `alumno16`):

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --hostname=bancal --accept-dns=false
   sudo tailscale set --operator=alumno   # para manejar serve y funnel sin sudo
   ```

   `tailscale up` muestra un link: abrirlo con la cuenta dueña de la red. `--accept-dns=false` deja el DNS del servidor como está, porque no necesita los nombres de la red de Tailscale.

2. **`secrets/.env` y `secrets/servicio.env` del servidor** (`~/bancal/software/broker/secrets/`): copiar los de `secrets.example/` con **claves nuevas y largas** (`openssl rand -base64 24`). El puerto MQTT es público, así que la clave es lo único que separa a un desconocido del broker. Además:
   - `BROKER_DNS=bancal.taile538b8.ts.net`;
   - `BROKER_IP` vacía.

3. **Subir y levantar:** `software/broker/desplegar.sh`. La primera vez copia la CA local (`ca.key` y `firmware/certs/ca.pem`), así el ESP32 confía en este broker con la misma CA.

4. **Publicar con Tailscale** (en `alumno16`). La primera vez, cada comando responde con un link para habilitar Serve y Funnel en la red: abrirlo con la cuenta dueña y volver a correrlo.

   ```bash
   tailscale funnel --bg --yes --tcp=443 tcp://127.0.0.1:8884
   tailscale serve --bg --yes --https=8443 http://127.0.0.1:8090
   tailscale serve status
   ```

   **¿Por qué el ESP32 va por el 443 y la web por el 8443?** Funnel solo publica en 443, 8443 o 10000, y la WiFi de la facultad ("Alumnos 2G") solo deja salir por 80 y 443. Con el 8443, el ESP32 se quedaba esperando la conexión (`esp-tls: select() timeout`, `tls=32774`). La web no tiene ese problema: va dentro del túnel de Tailscale, que el firewall no ve, así que cualquier puerto le sirve.

   La configuración queda guardada: sobrevive a reinicios de la máquina y de Tailscale. El nombre público (`bancal.taile538b8.ts.net` en el DNS de internet) tardó unos 4 minutos en aparecer la primera vez.

   Para comprobar desde cualquier máquina que el ESP32 va a poder conectarse (tiene que decir `Verify return code: 0 (ok)`):

   ```bash
   openssl s_client -connect bancal.taile538b8.ts.net:443 -verify_hostname bancal.taile538b8.ts.net \
     -CAfile firmware/certs/ca.pem </dev/null | grep "Verify return code"
   ```

   La IP pública de Funnel es compartida entre muchas máquinas de Tailscale, y la conexión llega a la nuestra por el nombre que manda el cliente en el saludo TLS (SNI). Un cliente que se conecte por IP no llega. El ESP32 manda el nombre solo, porque se conecta con `hostname`.

5. **ESP32:** en `firmware/include/config.h`, `MQTT_HOST = "bancal.taile538b8.ts.net"`, `MQTT_PORT = 443` y la clave nueva del ESP en `MQTT_PASS` (está en `secrets/.env` del servidor). Compilar y grabar.

### Compartir la web con el grupo

En la [consola de Tailscale](https://login.tailscale.com/admin/machines): máquina `bancal` → `⋯` → **Share** → invitar por mail o con un link. Cada uno acepta con su propia cuenta de Tailscale y `bancal` le aparece en su red, igual que `sd-2026`. Después entra a `https://bancal.taile538b8.ts.net:8443` desde cualquier red.

A quien se le comparte llega a la máquina por Tailscale, pero nuestros puertos están en `127.0.0.1`. Desde ahí solo ve la web (`serve`) y lo que ya escuchaba en todas las interfaces: el SSH y el cebador. La web no tiene login, así que quien la abre puede pasar a manual y manejar los actuadores: compartirla solo con el grupo. Para quitarle el acceso a alguien, en el mismo menú: **Share** → revocar.

### Por qué el puerto público es seguro (y qué no cubre)

Funnel publica **un solo puerto**, el 443, y lo pasa tal cual al puerto TLS de EMQX:

- **Cifrado de punta a punta:** el TLS es el nuestro. Funnel pasa los bytes sin descifrarlos (modo TCP), así que ni Tailscale ve el contenido.
- **Solo entra quien tiene usuario y clave:** EMQX los busca en MySQL y no acepta conexiones anónimas.
- **Cada usuario está limitado a sus tópicos:** la ACL deniega todo lo que no figure (`no_match = deny`). El ESP32 no puede, por ejemplo, publicar como el servicio.
- **Nada más está expuesto:** ni la web ni el panel de EMQX, MySQL o SSH.

Lo que no cubre:

- **Cualquiera puede intentar conectarse.** El nombre `bancal.taile538b8.ts.net` es público: queda en los registros de certificados. La defensa son las claves largas y aleatorias. Todas las conexiones llegan a EMQX desde la misma dirección local, así que no se puede bloquear por IP.
- **Una falla del propio EMQX:** conviene mantener la imagen actualizada.
- **Más seguro todavía** (pendiente): pedir certificado de cliente en el puerto TLS (TLS mutuo). Así, sin un certificado firmado por nuestra CA, nadie llegaría ni a probar una clave.
