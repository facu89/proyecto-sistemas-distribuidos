#pragma once

// Plantilla de configuración. Copiala como config.h (que no se sube a git) y completala:
//   cp include/config.example.h include/config.h

#include <stdint.h>

// Red WiFi (WPA2 personal, de 2,4 GHz)
constexpr const char *WIFI_SSID = "nombre-de-la-red";
constexpr const char *WIFI_PASS = "clave-de-la-red";

// Broker MQTT: la IP o el nombre de la máquina que corre EMQX, vista desde la red del ESP32.
// Tiene que figurar en el certificado del broker (BROKER_IP o BROKER_DNS en secrets/.env), si no el TLS falla.
// En el servidor (software/broker/README.md, "Servidor"): "bancal.taile538b8.ts.net" y puerto 8443.
constexpr const char *MQTT_HOST = "192.168.1.50";
constexpr uint32_t MQTT_PORT = 8883;  // MQTT sobre TLS

// Identidad del nodo. El nodoId es también el usuario MQTT del ESP32 (tabla mqtt_user).
constexpr const char *NODO_ID = "bancal1esp1";
constexpr const char *MQTT_PASS = "clave-del-esp";
