#!/bin/bash
# Lo corre el contenedor "mysql-actualizar" de compose.yaml en cada "compose up", con MySQL ya listo.
# Pone al día una base que ya tiene datos, SIN BORRAR NADA:
#   1. init.sql: crea las tablas que falten y agrega los permisos (ACL) nuevos. Todo es
#      CREATE TABLE IF NOT EXISTS e INSERT IGNORE, así que lo que ya existe queda igual.
#   2. 02-init-users.sh: los usuarios MQTT; si cambió una clave en secrets/.env, la actualiza.
#   3. El usuario "lector" de MySQL, con el que el servicio lee el historial (solo SELECT sobre
#      historial_lecturas). Su clave es MYSQL_LECTOR_PASSWORD; si no está, no se crea y la web
#      avisa que el historial no está disponible.
#
# Hace falta porque MySQL corre los scripts de docker-entrypoint-initdb.d solo cuando el volumen está
# vacío: sin esto, un cambio en init.sql obligaba a "compose down -v" y se perdía el historial.

set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export MYSQL_HOST="${MYSQL_HOST:-mysql}"
BASE="${MYSQL_DATABASE:-mqtt}"

sql() { MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -h "$MYSQL_HOST" -u root "$BASE"; }
# Para meter una clave entre comillas simples en SQL: cada ' se duplica
comillas() { printf "%s" "${1//\'/\'\'}"; }

echo "==> Tablas y permisos (init.sql)"
sql < "$AQUI/init.sql"

echo "==> Usuarios MQTT (02-init-users.sh)"
bash "$AQUI/02-init-users.sh"

if [ -n "${MYSQL_LECTOR_PASSWORD:-}" ]; then
    echo "==> Usuario lector (solo lectura del historial)"
    clave="$(comillas "$MYSQL_LECTOR_PASSWORD")"
    sql <<SQL
CREATE USER IF NOT EXISTS 'lector'@'%' IDENTIFIED BY '$clave';
ALTER USER 'lector'@'%' IDENTIFIED BY '$clave';
GRANT SELECT ON \`$BASE\`.historial_lecturas TO 'lector'@'%';
SQL
else
    echo "==> Sin MYSQL_LECTOR_PASSWORD en secrets/.env: no se crea el usuario lector (el historial no va a estar disponible en la web)"
fi

echo "==> MySQL al día"
