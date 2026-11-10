CREATE TABLE IF NOT EXISTS mqtt_user (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  salt VARCHAR(40) NOT NULL,
  is_superuser TINYINT(1) NOT NULL DEFAULT 0,
  created DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY mqtt_username (username)
);

-- Tabla de Control de Acceso (ACLs)
CREATE TABLE IF NOT EXISTS mqtt_acl (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  permission ENUM('allow', 'deny') NOT NULL,
  action ENUM('publish', 'subscribe', 'all') NOT NULL,
  topic VARCHAR(255) NOT NULL,
  UNIQUE KEY unique_acl (username, permission, action, topic)
);

-- Reglas dinámicas para cualquier ESP/nodo que se conecte:
-- EMQX evalúa '$all' y reemplaza ${username} por el usuario con el que se autenticó el ESP.
INSERT IGNORE INTO mqtt_acl (username, permission, action, topic) VALUES
  ('$all', 'allow', 'publish',   '${username}/sensor/+'),
  ('$all', 'allow', 'publish',   '${username}/actuador/+/estado'),
  ('$all', 'allow', 'publish',   '${username}/presencia'),
  ('$all', 'allow', 'subscribe', '${username}/actuador/+/cmd');

-- Regla para el cliente web / dashboard (solo lectura)
INSERT IGNORE INTO mqtt_acl (username, permission, action, topic) VALUES
  ('cliente_web', 'allow', 'subscribe', '+/sensor/+'),
  ('cliente_web', 'allow', 'subscribe', '+/actuador/+/estado'),
  ('cliente_web', 'allow', 'subscribe', '+/presencia'),
  ('cliente_web', 'allow', 'subscribe', 'alertas/#');

-- Regla de administrador (acceso total a todos los tópicos)
INSERT IGNORE INTO mqtt_acl (username, permission, action, topic) VALUES
  ('admin', 'allow', 'all', '#');

-- Historial de lecturas de sensores. Lo llena la regla guardar_historial de EMQX (config/emqx.conf):
--   * guarda una lectura por sensor (nodo + tipo) cada 10 minutos como mucho;
--   * borra las filas de más de 14 días (acción borrar_historial_viejo).
-- La lee el servicio con su usuario de MySQL (solo SELECT sobre esta tabla, ver actualizar.sh).
-- ts es la hora en que el broker recibió el mensaje, en UTC (la zona horaria del contenedor).
CREATE TABLE IF NOT EXISTS historial_lecturas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nodo VARCHAR(100) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  valor DOUBLE NOT NULL,
  ts DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  -- Para el chequeo "¿hay una lectura de este sensor en los últimos 10 minutos?"
  KEY idx_sensor_ts (nodo, tipo, ts),
  -- Para buscar rápido la fila más vieja (MIN(ts))
  KEY idx_ts (ts)
);

-- Configuración de cada bancal que se cambia desde la web: el modo (automático / manual) y los rangos de
-- los actuadores. La escribe y la lee el servicio (usuario "servicio" de MySQL, ver actualizar.sh) y la
-- carga al arrancar, así nada se pierde si se reinicia.
--   umbrales: JSON con los rangos propios del bancal; NULL = los valores por defecto del servicio (.env).
CREATE TABLE IF NOT EXISTS configuracion_nodo (
  nodo VARCHAR(100) NOT NULL,
  modo ENUM('automatico', 'manual') NOT NULL DEFAULT 'automatico',
  umbrales JSON NULL,
  actualizado DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (nodo)
);
