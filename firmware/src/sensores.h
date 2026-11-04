#pragma once

#include <math.h>

// Cada valor queda en NAN si su sensor no respondió en la última lectura.
struct Lecturas {
  float temperaturaSuelo = NAN;  // DS18B20, en °C
  float temperaturaAire = NAN;   // DHT11, en °C
  float humedadAire = NAN;       // DHT11, en %
  unsigned long instante = 0;    // millis() de la última lectura
  bool hayDatos = false;         // false hasta la primera lectura
};

void sensoresIniciar();

// Avanza la lectura sin bloquear. Devuelve true cuando deja lecturas nuevas.
bool sensoresActualizar(Lecturas &lecturas);
