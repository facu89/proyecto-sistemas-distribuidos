-- Plantilla de secrets/usuarios.sql: los usuarios MQTT que se cargan al crear la base.
-- MySQL lo ejecuta solo cuando el volumen está vacío (la primera vez, o después de borrarlo).
-- Para agregar un usuario con la base ya creada, correr el mismo INSERT a mano en MySQL.
--
-- EMQX valida sha256 con el salt adelante: password_hash = SHA2(salt + clave).
-- Los ESP32 usan su {nodoId} como usuario (ver topics.md).

-- Servicio
SET @salt = HEX(RANDOM_BYTES(8));
INSERT INTO mqtt_user (username, password_hash, salt)
VALUES ('servicio', SHA2(CONCAT(@salt, 'clave-del-servicio'), 256), @salt);

-- Nodo del bancal 1
SET @salt = HEX(RANDOM_BYTES(8));
INSERT INTO mqtt_user (username, password_hash, salt)
VALUES ('bancal1esp1', SHA2(CONCAT(@salt, 'clave-del-esp'), 256), @salt);

-- ACLs del nodo del bancal 1: solo puede usar sus propios tópicos (ver topics.md)
INSERT INTO mqtt_acl (username, permission, action, topic) VALUES
  ('bancal1esp1', 'allow', 'publish',   'bancal1esp1/sensor/+'),
  ('bancal1esp1', 'allow', 'publish',   'bancal1esp1/actuador/+/estado'),
  ('bancal1esp1', 'allow', 'publish',   'bancal1esp1/presencia'),
  ('bancal1esp1', 'allow', 'subscribe', 'bancal1esp1/actuador/+/cmd');
