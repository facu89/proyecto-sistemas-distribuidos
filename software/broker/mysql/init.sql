CREATE TABLE mqtt_user (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  salt VARCHAR(40) NOT NULL,
  is_superuser TINYINT(1) NOT NULL DEFAULT 0,
  created DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY mqtt_username (username)
);

-- Reglas de acceso (ACL) de cada usuario MQTT. Las filas se cargan en secrets/usuarios.sql
CREATE TABLE mqtt_acl (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  permission ENUM('allow', 'deny') NOT NULL,
  action ENUM('publish', 'subscribe', 'all') NOT NULL,
  topic VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  KEY mqtt_acl_username (username)
);
