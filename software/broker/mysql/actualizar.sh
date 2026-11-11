#!/bin/bash
# Lo corre el contenedor "mysql-actualizar" de compose.yaml en cada "compose up", con MySQL ya listo.
# Pone al día una base que ya tiene datos, SIN BORRAR NADA:
#   1. init.sql: crea las tablas que falten y agrega los permisos (ACL) nuevos. Todo es
#      CREATE TABLE IF NOT EXISTS e INSERT IGNORE, así que lo que ya existe queda igual.
#   2. 02-init-users.sh: los usuarios MQTT; si cambió una clave en secrets/.env, la actualiza.
#   3. El usuario "servicio" de MySQL, con el que el servicio lee el historial y guarda la configuración
#      de cada bancal. Solo puede leer historial_lecturas y leer/escribir configuracion_nodo, nada más.
#      Su clave es MYSQL_SERVICIO_PASSWORD (secrets/servicio.env); si no está, no se crea y la web avisa
#      que el historial no está disponible. Reemplaza al usuario "lector" (solo lectura) de antes.
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

if [ -n "${MYSQL_SERVICIO_PASSWORD:-}" ]; then
    echo "==> Usuario servicio de MySQL (lee el historial, lee y escribe configuracion_nodo)"
    clave="$(comillas "$MYSQL_SERVICIO_PASSWORD")"
    sql <<SQL
CREATE USER IF NOT EXISTS 'servicio'@'%' IDENTIFIED BY '$clave';
ALTER USER 'servicio'@'%' IDENTIFIED BY '$clave';
GRANT SELECT ON \`$BASE\`.historial_lecturas TO 'servicio'@'%';
GRANT SELECT, INSERT, UPDATE ON \`$BASE\`.configuracion_nodo TO 'servicio'@'%';
DROP USER IF EXISTS 'lector'@'%';
SQL
else
    echo "==> Sin MYSQL_SERVICIO_PASSWORD en secrets/servicio.env: no se crea el usuario servicio de MySQL (sin historial ni configuración guardada)"
fi

echo "==> MySQL al día"
