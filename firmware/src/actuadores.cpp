#include "actuadores.h"

#include <string.h>
#include <strings.h>

#include "pines.h"

namespace {

struct Actuador {
  const char *tipo;
  uint8_t pin;
  bool activoEnAlto;  // true: el relé cierra con HIGH (KY-019); false: con LOW (módulo de 2 relés)
  bool prendido;
};

// Para sumar un actuador (por ejemplo "bomba"), se agrega una fila con su pin en pines.h.
Actuador actuadores[] = {
    {"luz", PIN_RELE_LUZ, true, false},
    {"cooler", PIN_RELE_COOLER, false, false},
    {"riego", PIN_RELE_RIEGO, false, false},
};

constexpr size_t CANTIDAD = sizeof actuadores / sizeof actuadores[0];

// Devuelve 1 para prender, 0 para apagar y -1 si el valor no se entiende.
int interpretar(const char *valor) {
  if (strcmp(valor, "1") == 0) return 1;
  if (strcmp(valor, "0") == 0) return 0;
  return -1;
}

void escribir(Actuador &actuador, bool prendido) {
  digitalWrite(actuador.pin, prendido == actuador.activoEnAlto ? HIGH : LOW);
  actuador.prendido = prendido;
}

}  // namespace

void actuadoresIniciar() {
  for (Actuador &actuador : actuadores) {
    pinMode(actuador.pin, OUTPUT);
    escribir(actuador, false);
  }
}

int actuadoresAplicar(const char *tipo, const char *valor) {
  int prender = interpretar(valor);
  if (prender < 0) return -1;
  const char *t = (strcmp(tipo, "bomba") == 0) ? "riego" : tipo;
  for (size_t i = 0; i < CANTIDAD; i++) {
    if (strcmp(actuadores[i].tipo, t) == 0) {
      escribir(actuadores[i], prender == 1);
      return static_cast<int>(i);
    }
  }
  return -1;
}

size_t actuadoresCantidad() { return CANTIDAD; }

const char *actuadorTipo(size_t indice) { return actuadores[indice].tipo; }

bool actuadorPrendido(size_t indice) { return actuadores[indice].prendido; }
