# Broker (EMQX + MySQL)

EMQX es el broker MQTT; MySQL guarda los usuarios (`mqtt_user`), sus permisos (`mqtt_acl`) y el historial de lecturas (`historial_lecturas`: una lectura por sensor cada 10 minutos, se vacía cada 14 días; lo llena la regla `guardar_historial` de `config/emqx.conf`). Los tópicos y quién publica en cada uno están en [`topics.md`](topics.md).

## Primera vez

```bash
cd software/broker
cp -r secrets.example secrets   # y completar secrets/.env
./levantar.sh
```

`levantar.sh` funciona con Podman (`podman compose`) o con Docker (`docker compose`) y hace dos cosas:

1. Revisa que el certificado TLS del broker incluya las IPs actuales de la máquina (ver abajo). Si falta alguna, lo regenera.
2. Levanta los contenedores con `compose up -d` y, si regeneró el certificado, reinicia EMQX para que lo cargue.

Al final muestra la IP que va en `MQTT_HOST` del firmware.

Los usuarios y la ACL se cargan desde `mysql/init.sql` y `mysql/02-init-users.sh` **solo cuando el volumen de MySQL está vacío**. Si cambian `secrets/.env` o esos scripts, hay que borrar los volúmenes y volver a levantar:

```bash
podman compose down -v   # borra los datos de EMQX y MySQL
./levantar.sh
```

> **Podman con SELinux (Fedora):** los montajes de `compose.yaml` llevan `,z` para que los contenedores puedan leer los archivos de la carpeta. Sin eso, EMQX no arranca (`emqx.conf is not found`) y MySQL no corre `init.sql` (`Permission denied`). En Docker sin SELinux, `,z` no hace nada.

## Puertos

| Puerto | Uso |
|---|---|
| 1883 | MQTT sin cifrar (queda hasta que todos usen TLS) |
| 8883 | MQTT sobre TLS: lo usan el ESP32 y el servicio |
| 8083 | MQTT por WebSocket sin cifrar |
| 18083 | Panel de EMQX (usuario y clave en `secrets/.env`) |

## TLS: certificados

Los genera `security/generar_certificados.sh`:

- **CA** (`certs/ca.pem` y `certs/ca.key`): se crea solo si no existe. `ca.pem` está en git, porque el firmware la embebe (`firmware/scripts/copiar_ca.py`) y el servicio la usa para verificar al broker. `ca.key` **no se sube** y solo la tiene quien corre el broker.
- **Certificado del broker** (`certs/broker.pem` y `certs/broker.key`): firmado por la CA. Su SAN incluye `localhost`, `emqx`, `127.0.0.1` y las IPs de la máquina. Sin argumentos, el script las detecta solo (`security/ips_locales.sh`); también se le pueden pasar a mano: `./generar_certificados.sh 192.168.1.50`.

Si se regenera solo el certificado del broker, `ca.pem` no cambia y el firmware ya grabado sigue sirviendo. Para hacer una CA nueva hay que borrar `certs/ca.pem` y `certs/ca.key`, y después recompilar y grabar el ESP32.

### Si cambia la red o la IP de la máquina

El ESP32 verifica que la IP a la que se conecta (`MQTT_HOST`) figure en el certificado del broker. Si la máquina se conecta a otra red, o el router le asigna otra IP:

1. **Regenerar el certificado y reiniciar EMQX:** correr `./levantar.sh`. Detecta la IP nueva, regenera el certificado con la misma CA y reinicia EMQX. Hacerlo a mano sería:
   ```bash
   security/generar_certificados.sh   # detecta las IPs actuales
   podman restart emqx                # EMQX lee el certificado al arrancar
   ```
2. **Actualizar el ESP32:** poner la IP nueva en `MQTT_HOST` de `firmware/include/config.h`, compilar y grabar. La CA no cambió, así que no hace falta nada más.
3. **El servicio** (`software/servicio`) no necesita cambios, porque se conecta por `localhost`.

Para que la IP no cambie, conviene reservarla en el router (DHCP estático) para la máquina del broker.

El certificado del broker dura 365 días; la CA, 10 años. Para renovar el del broker alcanza con volver a correr el script.
