#pragma once

#include <Arduino.h>

// Sensores (ver el esquema de conexiones)
constexpr uint8_t PIN_DS18B20 = 4;  // sonda de suelo, con pull-up de 4,7 kΩ a 3V3
constexpr uint8_t PIN_DHT = 5;      // DHT11 (KY-015), trae su pull-up en la placa
constexpr uint8_t PIN_LUZ = 3;            // DO del módulo LDR (digital: luz sí o no)
constexpr uint8_t PIN_HUMEDAD_SUELO = 7;       // una punta de la sonda HW-080, con 10 kΩ a GND (ADC1, lee con WiFi prendido)
constexpr uint8_t PIN_ALIMENTACION_SUELO = 6;  // la otra punta: se pone en HIGH solo mientras se mide

// Actuadores
constexpr uint8_t PIN_RELE_LUZ = 33;     // S del relé KY-019 (activo en HIGH) que maneja la lámpara
constexpr uint8_t PIN_RELE_COOLER = 47;  // IN1 del módulo de 2 relés (activo en LOW, VCC a Ve y JD-VCC a 5V, sin jumper)

// Pantalla OLED integrada. Los valores vienen de la variante de la placa.
constexpr uint8_t PIN_OLED_SDA = SDA_OLED;  // GPIO17
constexpr uint8_t PIN_OLED_SCL = SCL_OLED;  // GPIO18
constexpr uint8_t PIN_OLED_RST = RST_OLED;  // GPIO21
constexpr uint8_t PIN_VEXT = Vext;          // GPIO36, en LOW alimenta el OLED
