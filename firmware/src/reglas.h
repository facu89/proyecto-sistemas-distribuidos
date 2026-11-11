#pragma once

// Reglas de los actuadores, aplicadas en el propio ESP32 (así el bancal sigue funcionando aunque se
// caiga el servicio o el broker). Son las mismas que software/servicio/src/reglas.ts: si se cambia una,
// hay que cambiar la otra y sus tests (test/test_reglas.c y reglas.test.ts).
//
// Está en C puro, sin Arduino, para poder probarlo en la computadora: ver test/README.

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  float riegoPrendeBajo;    // riego: prende con humedad_suelo < esto (%)
  float riegoApagaDesde;    // riego: apaga con humedad_suelo >= esto (%)
  float coolerPrendeDesde;  // cooler: prende con temperatura_aire >= esto (°C)
  float coolerApagaBajo;    // cooler: apaga con temperatura_aire < esto (°C)
  bool luzConHorario;       // luz: si es true, a oscuras prende solo dentro del horario
  int luzDesde;             // minutos desde la medianoche (hora local), inclusive
  int luzHasta;             // minutos desde la medianoche, exclusive (si es menor que desde, cruza la medianoche)
} Rangos;

// Los mismos valores por defecto que el servicio (.env): riego 20/70 %, cooler 28/26 °C, luz sin horario.
Rangos rangosPorDefecto(void);

// Márgenes y límites, iguales a los del servicio (validarUmbrales en reglas.ts).
#define MARGEN_RIEGO 5.0f
#define MARGEN_COOLER 2.0f

// NULL si los rangos son válidos; si no, el motivo.
const char *rangosProblema(const Rangos *r);

// Si `minuto` está en [desde, hasta), cruzando la medianoche cuando hasta < desde.
bool dentroDelHorario(int minuto, int desde, int hasta);

// Cada función devuelve 1 (prender), 0 (apagar) o -1 (sin decisión: lectura inválida, no cambia nada).
// `actual` es el estado actual del actuador: entre los dos umbrales (histéresis) se mantiene.
int decidirRiego(float humedadSuelo, bool actual, const Rangos *r);
int decidirCooler(float temperaturaAire, bool actual, const Rangos *r);
// `minutoLocal` < 0 si el ESP32 todavía no sabe la hora (sin NTP): se ignora el horario.
int decidirLuz(bool hayLuz, int minutoLocal, const Rangos *r);

#ifdef __cplusplus
}
#endif
