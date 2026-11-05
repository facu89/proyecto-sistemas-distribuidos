CREATE DATABASE IF NOT EXISTS mqtt;
USE mqtt;

-- El usuario 'emqx' y sus permisos sobre la base 'mqtt' los crea la imagen de MySQL
-- a partir de MYSQL_USER / MYSQL_PASSWORD (ver compose.yaml y .env).

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS mqtt_user (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(100) NOT NULL,
    is_superuser BOOLEAN DEFAULT FALSE,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Control de Acceso (ACLs)
CREATE TABLE IF NOT EXISTS mqtt_acl (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    permission ENUM('allow', 'deny') NOT NULL,
    action ENUM('publish', 'subscribe', 'all') NOT NULL,
    topic VARCHAR(255) NOT NULL
);

-- Datos de prueba para el nodo inicial
INSERT INTO mqtt_user (username, password_hash, salt, is_superuser) 
VALUES ('bancal1', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', '', FALSE);

INSERT INTO mqtt_acl (username, permission, action, topic) VALUES ('bancal1', 'allow', 'publish', 'bancal1/sensor/+');
INSERT INTO mqtt_acl (username, permission, action, topic) VALUES ('bancal1', 'allow', 'publish', 'bancal1/actuador/+/estado');
INSERT INTO mqtt_acl (username, permission, action, topic) VALUES ('bancal1', 'allow', 'publish', 'bancal1/presencia');
INSERT INTO mqtt_acl (username, permission, action, topic) VALUES ('bancal1', 'allow', 'subscribe', 'bancal1/actuador/+/cmd');