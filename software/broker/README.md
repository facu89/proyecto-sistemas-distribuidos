# Broker (EMQX + MySQL)

EMQX es el broker MQTT; MySQL guarda los usuarios (`mqtt_user`), sus permisos (`mqtt_acl`) y el historial de lecturas (`historial_lecturas`: una lectura por sensor cada 10 minutos, se vacía cada 14 días; lo llena la regla `guardar_historial` de `config/emqx.conf`). Los tópicos y quién publica en cada uno están en [`topics.md`](topics.md).

## Cómo se levanta

Solo hace falta Docker (o Podman). No hay que instalar Node, pnpm ni OpenSSL: todo se genera en contenedores.

```bash
cd software/broker
cp -r secrets.example secrets   # la primera vez, y completar secrets/.env (BROKER_IP incluida)
docker compose up -d            # o: podman compose up -d
```

Levanta cuatro contenedores, en orden:

| Contenedor | Qué hace |
|---|---|
| `certs` | Corre y termina. Deja listo el certificado TLS del broker en `security/certs` y solo lo regenera si hace falta (ver [TLS](#tls-certificados)). |
| `mysql` | Usuarios, ACL e historial de lecturas. |
| `emqx` | El broker. Arranca cuando `certs` terminó bien y MySQL está listo. |
| `servicio` | El [servicio central](../servicio/README.md): reglas de los actuadores y la web en **http://localhost:8080**. Su imagen también compila la web. Arranca cuando EMQX está listo. |

La primera vez tarda porque baja las imágenes y compila la web; después arranca en segundos. Si se cambia el código del servicio o de la web, hay que reconstruir la imagen: `docker compose up -d --build`.

Comandos útiles: `docker compose ps` (estado), `docker compose logs -f servicio` (logs), `docker compose down` (apagar).

Los usuarios y la ACL se cargan desde `mysql/init.sql` y `mysql/02-init-users.sh` **solo cuando el volumen de MySQL está vacío**. Si cambian `secrets/.env` (los usuarios MQTT) o esos scripts, hay que borrar los volúmenes y volver a levantar:

```bash
docker compose down -v   # borra los datos de EMQX y MySQL
docker compose up -d
```

`levantar.sh` es la forma anterior, que corre en la máquina y detecta sola las IPs. Sigue funcionando, pero necesita bash y OpenSSL instalados.

> **Podman con SELinux (Fedora):** los montajes de `compose.yaml` llevan `,z` para que los contenedores puedan leer los archivos de la carpeta. Sin eso, EMQX no arranca (`emqx.conf is not found`) y MySQL no corre `init.sql` (`Permission denied`). En Docker sin SELinux, `,z` no hace nada.

## Puertos

| Puerto | Uso |
|---|---|
| 1883 | MQTT sin cifrar (queda hasta que todos usen TLS) |
| 8883 | MQTT sobre TLS: lo usan el ESP32 y el servicio |
| 8083 | MQTT por WebSocket sin cifrar |
| 18083 | Panel de EMQX (usuario y clave en `secrets/.env`) |
| 8080 | Web y API del servicio |

## TLS: certificados

Con `compose up`, el contenedor `certs` corre `security/preparar_certificados.sh`, que regenera el certificado del broker solo si no existe, no lo firmó la CA actual, no coincide con su clave, vence en menos de 30 días o no incluye alguna IP de `BROKER_IP` o algún nombre de `BROKER_DNS`. Desde adentro de un contenedor no se pueden ver las IPs de la máquina, por eso `BROKER_IP` va en `secrets/.env`. `BROKER_DNS` hace falta cuando el ESP32 se conecta por nombre, como en el [servidor](#servidor).

**Los certificados no están en git** (`security/certs/*.pem` está en `.gitignore`): cada máquina genera los suyos y tiene su propia CA. Así nadie pisa los del otro.

- Si no hay `ca.key` (por ejemplo, en un clon nuevo del repo), crea una CA nueva: el ESP32 se tiene que recompilar y grabar en esa máquina.
- Si está `ca.key` pero falta `ca.pem`, rearma `ca.pem` con la misma clave. El ESP32 ya grabado lo sigue aceptando, porque verifica la firma con esa clave.
- Si `ca.pem` y `ca.key` son de CAs distintas, falla con un mensaje (EMQX no arranca) en vez de adivinar cuál usar.

Los certificados los genera `security/generar_certificados.sh`:

- **CA** (`certs/ca.pem` y `certs/ca.key`): se crea solo si no existe. El firmware embebe `ca.pem` (la copia al compilar `firmware/scripts/copiar_ca.py`) y el servicio la usa para verificar al broker. Ninguno de los dos archivos se sube a git.
- **Certificado del broker** (`certs/broker.pem` y `certs/broker.key`): firmado por la CA. Su SAN incluye `localhost`, `emqx`, `127.0.0.1` y las IPs de la máquina. Sin argumentos, el script las detecta solo (`security/ips_locales.sh`); también se le pueden pasar a mano IPs y nombres: `./generar_certificados.sh 192.168.1.50 bancal.taile538b8.ts.net`.

Si se regenera solo el certificado del broker, `ca.pem` no cambia y el firmware ya grabado sigue sirviendo. Para hacer una CA nueva hay que borrar `certs/ca.pem` y `certs/ca.key`, y después recompilar y grabar el ESP32.

### Si cambia la red o la IP de la máquina

El ESP32 verifica que la IP a la que se conecta (`MQTT_HOST`) figure en el certificado del broker. Si la máquina se conecta a otra red, o el router le asigna otra IP:

1. **Regenerar el certificado:** poner la IP nueva en `BROKER_IP` de `secrets/.env` y correr `docker compose up -d`. Como cambió `.env`, compose recrea los contenedores: `certs` regenera el certificado con la misma CA y EMQX arranca con el nuevo. (Con `./levantar.sh` la IP se detecta sola.)
2. **Actualizar el ESP32:** poner la IP nueva en `MQTT_HOST` de `firmware/include/config.h`, compilar y grabar. La CA no cambió, así que no hace falta nada más.
3. **El servicio** no necesita cambios, porque se conecta al broker por el nombre `emqx` dentro de la red de compose.
4. **Windows:** el firewall tiene que dejar entrar conexiones al puerto 8883 desde la red del ESP32 (si la red es "Pública", por defecto las bloquea).

Para que la IP no cambie, conviene reservarla en el router (DHCP estático) para la máquina del broker.

El certificado del broker dura 365 días; la CA, 10 años. Para renovar el del broker alcanza con volver a correr el script.

## Servidor

Todo corre en `alumno16`, el nodo de la cátedra en `sd-2026`. Es un contenedor Debian con Docker, sin puertos abiertos a internet. Se entra por SSH a través de `sd-2026`, la máquina del profe compartida a nuestra red de Tailscale:

```bash
ssh -p 22116 alumno@100.117.231.80
```

`alumno16` tiene su propio Tailscale, en la red de Guido (`taile538b8.ts.net`), con el nombre **`bancal`**. Así se llega a cada cosa:

| Quién | Cómo | Dirección |
|---|---|---|
| El grupo (la web) | `tailscale serve`: HTTPS con certificado válido, **solo dentro de la red de Tailscale** | `https://bancal.taile538b8.ts.net` |
| El ESP32 | `tailscale funnel`: **el único puerto público**, que pasa directo a EMQX | `bancal.taile538b8.ts.net:8443` |
| Panel de EMQX | Túnel SSH, después abrir http://localhost:18083 | `ssh -L 18083:localhost:18083 -p 22116 alumno@100.117.231.80` |

En el servidor, `compose.servidor.yaml` deja todos los puertos de compose en `127.0.0.1`:

| Puerto local | Qué | Quién llega |
|---|---|---|
| 8883 | MQTT con TLS | Funnel (`:8443`) |
| 18083 | Panel de EMQX | Túnel SSH |
| 8090 | Web y API del servicio | `serve` (`:443`) |

El 8080 lo usa el cebador de la clase 14, por eso el servicio va en el 8090. 1883 y 8083, sin cifrar, no se publican. Ni las otras máquinas de la red de la facultad ni los reenvíos de `sd-2026` (`183NN`, `188NN`, `181NN`) llegan a nada nuestro.

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

2. **`secrets/.env` del servidor** (`~/bancal/software/broker/secrets/.env`): copiar `secrets.example/.env` con **claves nuevas y largas** (`openssl rand -base64 24`). El puerto MQTT es público, así que la clave es lo único que separa a un desconocido del broker. Además:
   - `BROKER_DNS=bancal.taile538b8.ts.net`;
   - `BROKER_IP` vacía.

3. **Subir y levantar:** `software/broker/desplegar.sh`. La primera vez copia la CA local (`ca.key` y `firmware/certs/ca.pem`), así el ESP32 confía en este broker con la misma CA.

4. **Publicar con Tailscale** (en `alumno16`; la primera vez, Tailscale pide activar HTTPS y Funnel en la red con un link):

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:8090
   tailscale funnel --bg --tcp=8443 tcp://127.0.0.1:8883
   tailscale serve status
   ```

5. **ESP32:** en `firmware/include/config.h`, `MQTT_HOST = "bancal.taile538b8.ts.net"`, `MQTT_PORT = 8443` y la clave nueva del ESP en `MQTT_PASS`. Compilar y grabar.

### Compartir la web con el grupo

En la [consola de Tailscale](https://login.tailscale.com/admin/machines): máquina `bancal` → `⋯` → **Share** → invitar por mail o con un link. Cada uno acepta con su propia cuenta de Tailscale y `bancal` le aparece en su red, igual que `sd-2026`. Después entra a `https://bancal.taile538b8.ts.net` desde cualquier red.

A quien se le comparte llega a la máquina por Tailscale, pero nuestros puertos están en `127.0.0.1`. Desde ahí solo ve la web (`serve`) y lo que ya escuchaba en todas las interfaces: el SSH y el cebador. La web no tiene login, así que quien la abre puede pasar a manual y manejar los actuadores: compartirla solo con el grupo. Para quitarle el acceso a alguien, en el mismo menú: **Share** → revocar.

### Por qué el puerto público es seguro (y qué no cubre)

Funnel publica **un solo puerto**, el 8443, y lo pasa tal cual al 8883 de EMQX:

- **Cifrado de punta a punta:** el TLS es el nuestro. Funnel pasa los bytes sin descifrarlos (modo TCP), así que ni Tailscale ve el contenido.
- **Solo entra quien tiene usuario y clave:** EMQX los busca en MySQL y no acepta conexiones anónimas.
- **Cada usuario está limitado a sus tópicos:** la ACL deniega todo lo que no figure (`no_match = deny`). El ESP32 no puede, por ejemplo, publicar como el servicio.
- **Nada más está expuesto:** ni la web ni el panel de EMQX, MySQL o SSH.

Lo que no cubre:

- **Cualquiera puede intentar conectarse.** El nombre `bancal.taile538b8.ts.net` es público: queda en los registros de certificados. La defensa son las claves largas y aleatorias. Todas las conexiones llegan a EMQX desde la misma dirección local, así que no se puede bloquear por IP.
- **Una falla del propio EMQX:** conviene mantener la imagen actualizada.
- **Más seguro todavía** (pendiente): pedir certificado de cliente en el puerto 8883 (TLS mutuo). Así, sin un certificado firmado por nuestra CA, nadie llegaría ni a probar una clave.
