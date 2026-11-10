#!/usr/bin/env bash
# Pasa las claves del servicio de secrets/.env a secrets/servicio.env (ver README.md, "Secretos: quién ve qué").
# Hace falta una sola vez en cada máquina que ya tenía secrets/.env de antes; si servicio.env ya existe, no
# hace nada. desplegar.sh lo corre solo en el servidor.
#
#   software/broker/separar_secretos.sh
#
# Mueve MQTT_SERVICIO_USER, MQTT_SERVICIO_PASSWORD y MYSQL_LECTOR_PASSWORD (si no estaba, genera una clave).
# Deja una copia del .env anterior en secrets/.env.antes-de-separar por si algo sale mal.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/secrets"

if [ -f servicio.env ]; then
    echo "==> secrets/servicio.env ya existe: no se cambia nada"
    exit 0
fi
if [ ! -f .env ]; then
    echo "ERROR: no está secrets/.env (la primera vez: cp -r secrets.example secrets y completar los dos archivos)" >&2
    exit 1
fi

valor() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
usuario="$(valor MQTT_SERVICIO_USER)"
clave="$(valor MQTT_SERVICIO_PASSWORD)"
lector="$(valor MYSQL_LECTOR_PASSWORD)"
if [ -z "$clave" ]; then
    echo "ERROR: secrets/.env no tiene MQTT_SERVICIO_PASSWORD; crear servicio.env a mano desde secrets.example/servicio.env" >&2
    exit 1
fi
[ -n "$lector" ] || lector="$(openssl rand -hex 24)"

cp -p .env .env.antes-de-separar
umask 077
cat > servicio.env <<FIN
# Claves del servicio: es el único archivo de secretos que ve su contenedor (ver secrets.example/servicio.env).
MQTT_SERVICIO_USER=${usuario:-servicio}
MQTT_SERVICIO_PASSWORD=$clave
MYSQL_LECTOR_PASSWORD=$lector
FIN
grep -vE '^(MQTT_SERVICIO_USER|MQTT_SERVICIO_PASSWORD|MYSQL_LECTOR_PASSWORD)=' .env.antes-de-separar > .env
chmod 600 .env servicio.env .env.antes-de-separar
echo "==> Claves del servicio movidas a secrets/servicio.env (copia del .env anterior en secrets/.env.antes-de-separar)"
