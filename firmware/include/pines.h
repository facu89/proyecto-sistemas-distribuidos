#pragma once

#include <Arduino.h>

// Sensores (ver el esquema de conexiones)
constexpr uint8_t PIN_DS18B20 = 4;  // sonda de suelo, con pull-up de 4,7 kΩ a 3V3
constexpr uint8_t PIN_DHT = 5;      // DHT11 (KY-015), trae su pull-up en la placa

// Pantalla OLED integrada. Los valores vienen de la variante de la placa.
constexpr uint8_t PIN_OLED_SDA = SDA_OLED;  // GPIO17
constexpr uint8_t PIN_OLED_SCL = SCL_OLED;  // GPIO18
constexpr uint8_t PIN_OLED_RST = RST_OLED;  // GPIO21
constexpr uint8_t PIN_VEXT = Vext;          // GPIO36, en LOW alimenta el OLED
