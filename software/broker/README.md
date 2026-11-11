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
| 8883 | MQTT sobre TLS: lo usan el ESP32 y el servicio. Es el único puerto MQTT abierto |
| 18083 | Panel de EMQX (usuario y clave en `secrets/.env`) |
| 8080 | Web y API del servicio |

Los listeners sin cifrar de EMQX (1883 MQTT y 8083 WebSocket) están apagados en `config/emqx.conf` y no se publican en `compose.yaml`: solo se entra por TLS.

## TLS: certificados

Con `compose up`, el contenedor `certs` corre `security/preparar_certificados.sh`, que regenera el certificado del broker solo si no existe, no lo firmó la CA actual, no coincide con su clave, vence en menos de 30 días o no incluye alguna IP de `BROKER_IP`. Desde adentro de un contenedor no se pueden ver las IPs de la máquina, por eso `BROKER_IP` va en `secrets/.env`.

**Los certificados no están en git** (`security/certs/*.pem` está en `.gitignore`): cada máquina genera los suyos y tiene su propia CA. Así nadie pisa los del otro.

- Si no hay `ca.key` (por ejemplo, en un clon nuevo del repo), crea una CA nueva: el ESP32 se tiene que recompilar y grabar en esa máquina.
- Si está `ca.key` pero falta `ca.pem`, rearma `ca.pem` con la misma clave. El ESP32 ya grabado lo sigue aceptando, porque verifica la firma con esa clave.
- Si `ca.pem` y `ca.key` son de CAs distintas, falla con un mensaje (EMQX no arranca) en vez de adivinar cuál usar.

Los certificados los genera `security/generar_certificados.sh`:

- **CA** (`certs/ca.pem` y `certs/ca.key`): se crea solo si no existe. El firmware embebe `ca.pem` (la copia al compilar `firmware/scripts/copiar_ca.py`) y el servicio la usa para verificar al broker. Ninguno de los dos archivos se sube a git.
- **Certificado del broker** (`certs/broker.pem` y `certs/broker.key`): firmado por la CA. Su SAN incluye `localhost`, `emqx`, `127.0.0.1` y las IPs de la máquina. Sin argumentos, el script las detecta solo (`security/ips_locales.sh`); también se le pueden pasar a mano: `./generar_certificados.sh 192.168.1.50`.

Si se regenera solo el certificado del broker, `ca.pem` no cambia y el firmware ya grabado sigue sirviendo. Para hacer una CA nueva hay que borrar `certs/ca.pem` y `certs/ca.key`, y después recompilar y grabar el ESP32.

### Si cambia la red o la IP de la máquina

El ESP32 verifica que la IP a la que se conecta (`MQTT_HOST`) figure en el certificado del broker. Si la máquina se conecta a otra red, o el router le asigna otra IP:

1. **Regenerar el certificado:** poner la IP nueva en `BROKER_IP` de `secrets/.env` y correr `docker compose up -d`. Como cambió `.env`, compose recrea los contenedores: `certs` regenera el certificado con la misma CA y EMQX arranca con el nuevo. (Con `./levantar.sh` la IP se detecta sola.)
2. **Actualizar el ESP32:** poner la IP nueva en `MQTT_HOST` de `firmware/include/config.h`, compilar y grabar. La CA no cambió, así que no hace falta nada más.
3. **El servicio** no necesita cambios, porque se conecta al broker por el nombre `emqx` dentro de la red de compose.
4. **Windows:** el firewall tiene que dejar entrar conexiones al puerto 8883 desde la red del ESP32 (si la red es "Pública", por defecto las bloquea).

Para que la IP no cambie, conviene reservarla en el router (DHCP estático) para la máquina del broker.

El certificado del broker dura 365 días; la CA, 10 años. Para renovar el del broker alcanza con volver a correr el script.
