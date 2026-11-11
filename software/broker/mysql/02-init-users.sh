#!/bin/bash
# Este script se ejecuta automáticamente cuando se inicia el contenedor de MySQL por primera vez.
# Lee las credenciales pasadas por variables de entorno (cargadas desde secrets/.env)
# e inserta los usuarios en la tabla mqtt_user con sal aleatoria de 8 bytes y hash SHA-256.

set -e

# Corre en dos lugares:
#   - al crear la base (docker-entrypoint-initdb.d): usa docker_process_sql del entrypoint de MySQL;
#   - en cada "compose up", desde el contenedor mysql-actualizar (actualizar.sh), que define MYSQL_HOST.
# Las sentencias se pueden repetir sin duplicar nada (ON DUPLICATE KEY UPDATE), así que volver a
# correrlo solo actualiza las claves si cambiaron en secrets/.env.
ejecutar_sql() {
    if declare -f docker_process_sql > /dev/null; then
        docker_process_sql --database="$MYSQL_DATABASE"
    elif [ -n "${MYSQL_HOST:-}" ]; then
        MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -h "$MYSQL_HOST" -u root "$MYSQL_DATABASE"
    else
        mysql -u root -p"$MYSQL_ROOT_PASSWORD" --socket="${MYSQL_UNIX_PORT:-/var/run/mysqld/mysqld.sock}" "$MYSQL_DATABASE"
    fi
}

ejecutar_sql <<EOF
-- Usuario del servicio central
SET @salt_srv = HEX(RANDOM_BYTES(8));
INSERT INTO mqtt_user (username, password_hash, salt)
VALUES ('${MQTT_SERVICIO_USER:-servicio}', SHA2(CONCAT(@salt_srv, '${MQTT_SERVICIO_PASSWORD:-clave-del-servicio}'), 256), @salt_srv)
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), salt=VALUES(salt);

-- Usuario del nodo ESP32 (por defecto bancal1esp1)
SET @salt_esp = HEX(RANDOM_BYTES(8));
INSERT INTO mqtt_user (username, password_hash, salt)
VALUES ('${MQTT_ESP_USER:-bancal1esp1}', SHA2(CONCAT(@salt_esp, '${MQTT_ESP_PASSWORD:-clave-del-esp}'), 256), @salt_esp)
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), salt=VALUES(salt);

-- Usuario del ESP32 simulado (software/simulador), si está configurado: un segundo bancal que corre en
-- una computadora. Las reglas de ACL de los nodos ($all con ${username}) le valen igual que a la placa.
SET @salt_sim = HEX(RANDOM_BYTES(8));
INSERT INTO mqtt_user (username, password_hash, salt)
SELECT '${MQTT_SIMULADOR_USER:-}', SHA2(CONCAT(@salt_sim, '${MQTT_SIMULADOR_PASSWORD:-}'), 256), @salt_sim
FROM DUAL WHERE '${MQTT_SIMULADOR_USER:-}' <> '' AND '${MQTT_SIMULADOR_PASSWORD:-}' <> ''
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), salt=VALUES(salt);

-- Usuario administrador (superusuario)
SET @salt_adm = HEX(RANDOM_BYTES(8));
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser)
VALUES ('${MQTT_ADMIN_USER:-admin}', SHA2(CONCAT(@salt_adm, '${MQTT_ADMIN_PASSWORD:-admin123}'), 256), @salt_adm, 1)
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), salt=VALUES(salt);

-- Usuario del cliente web / dashboard
SET @salt_web = HEX(RANDOM_BYTES(8));
INSERT INTO mqtt_user (username, password_hash, salt)
VALUES ('${MQTT_WEB_USER:-cliente_web}', SHA2(CONCAT(@salt_web, '${MQTT_WEB_PASSWORD:-clave-cliente-web}'), 256), @salt_web)
ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), salt=VALUES(salt);

-- Permisos ACL para el usuario de servicio configurado dinámicamente:
INSERT INTO mqtt_acl (username, permission, action, topic) VALUES
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'subscribe', '+/sensor/+'),
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'publish',   '+/actuador/+/cmd'),
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'subscribe', '+/actuador/+/estado'),
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'subscribe', '+/presencia'),
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'subscribe', 'alertas/#'),
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'publish',   '+/config'),
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'subscribe', '+/config/aplicada'),
  ('${MQTT_SERVICIO_USER:-servicio}', 'allow', 'publish',   'servicio/conexion')
ON DUPLICATE KEY UPDATE permission=VALUES(permission);
EOF
