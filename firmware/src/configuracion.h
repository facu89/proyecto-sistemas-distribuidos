#pragma once

#include <stddef.h>
#include <stdint.h>

#include "reglas.h"

// Configuración del bancal que manda el servicio en {nodoId}/config (retenido): modo, rangos y zona horaria.
// Se guarda en la memoria permanente (NVS): si el ESP32 se reinicia sin broker, sigue con la última.

enum class Modo : uint8_t { Automatico, Manual };

struct ConfigBancal {
  uint64_t version = 0;  // la "v" del servicio; 0 = nunca recibió una (usa los valores por defecto)
  Modo modo = Modo::Automatico;
  Rangos rangos = rangosPorDefecto();
  char zona[40] = "<-03>3";  // zona horaria POSIX para el horario de la luz (Argentina: UTC-3)
};

// La guardada en NVS, o la por defecto si no hay ninguna (o es de otro formato).
ConfigBancal configCargar();
void configGuardar(const ConfigBancal &config);

// Interpreta el JSON de {nodoId}/config:
//   {"v": 1731264000000, "modo": "automatico", "riego": [20, 70], "cooler": [28, 26],
//    "pulso": [5, 2], "luz": null | ["18:00", "23:00"], "tz": "<-03>3"}
// "pulso" (segundos de riego y lecturas de espera) es opcional: sin él, 5 s y 2 lecturas.
// Devuelve NULL si está bien (y la deja en `salida`); si no, el motivo (y `salida` no cambia).
const char *configInterpretar(const char *json, ConfigBancal &salida);

// {"v": ..., "modo": "manual", "efectivo": "automatico"} para {nodoId}/config/aplicada
void configResumen(const ConfigBancal &config, Modo efectivo, char *destino, size_t tamano);

const char *modoNombre(Modo modo);
