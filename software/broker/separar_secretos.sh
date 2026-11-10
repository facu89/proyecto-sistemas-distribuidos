#!/usr/bin/env bash
# Pone al día secrets/ con el formato actual (ver README.md, "Secretos: quién ve qué"). Se puede correr las
# veces que sea: lo que ya está hecho no se toca. desplegar.sh lo corre solo en el servidor.
#   1. Pasa las claves del servicio de secrets/.env a secrets/servicio.env.
#   2. Renombra MYSQL_LECTOR_PASSWORD a MYSQL_SERVICIO_PASSWORD (el usuario "lector" pasó a ser "servicio").
#
#   software/broker/separar_secretos.sh
#
# Deja una copia del .env anterior en secrets/.env.antes-de-separar por si algo sale mal.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/secrets"

renombrar_lector() {
    if grep -q '^MYSQL_LECTOR_PASSWORD=' servicio.env && ! grep -q '^MYSQL_SERVICIO_PASSWORD=' servicio.env; then
        sed -i 's/^MYSQL_LECTOR_PASSWORD=/MYSQL_SERVICIO_PASSWORD=/' servicio.env
        echo "==> secrets/servicio.env: MYSQL_LECTOR_PASSWORD pasa a llamarse MYSQL_SERVICIO_PASSWORD"
    fi
}

if [ -f servicio.env ]; then
    renombrar_lector
    echo "==> secrets/servicio.env al día"
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
MYSQL_SERVICIO_PASSWORD=$lector
FIN
grep -vE '^(MQTT_SERVICIO_USER|MQTT_SERVICIO_PASSWORD|MYSQL_LECTOR_PASSWORD)=' .env.antes-de-separar > .env
chmod 600 .env servicio.env .env.antes-de-separar
echo "==> Claves del servicio movidas a secrets/servicio.env (copia del .env anterior en secrets/.env.antes-de-separar)"
