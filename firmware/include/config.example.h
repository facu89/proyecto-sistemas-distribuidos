#pragma once

// Plantilla de configuración. Copiala como config.h (que no se sube a git) y completala:
//   cp include/config.example.h include/config.h

#include <stdint.h>

// Red WiFi (WPA2 personal, de 2,4 GHz)
constexpr const char *WIFI_SSID = "nombre-de-la-red";
constexpr const char *WIFI_PASS = "clave-de-la-red";

// Broker MQTT: la IP de la computadora que corre EMQX, vista desde la red del ESP32.
constexpr const char *MQTT_HOST = "192.168.1.50";
constexpr uint32_t MQTT_PORT = 1883;

// Identidad del nodo. El nodoId es también el usuario MQTT del ESP32 (tabla mqtt_user).
constexpr const char *NODO_ID = "bancal1esp1";
constexpr const char *MQTT_PASS = "clave-del-esp";
