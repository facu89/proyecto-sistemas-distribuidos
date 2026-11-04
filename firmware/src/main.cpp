#include <Arduino.h>

#include "pantalla.h"
#include "sensores.h"

namespace {

constexpr unsigned long REFRESCO_PANTALLA_MS = 500;  // para que el "hace N s" avance

Lecturas lecturas;
unsigned long ultimoRefresco = 0;

void imprimir(const Lecturas &l) {
  Serial.printf("suelo=%.1f C  aire=%.1f C  humedad=%.0f %%\n",
                l.temperaturaSuelo, l.temperaturaAire, l.humedadAire);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  pantallaIniciar();
  sensoresIniciar();
}

void loop() {
  bool nuevas = sensoresActualizar(lecturas);
  if (nuevas) imprimir(lecturas);

  if (nuevas || millis() - ultimoRefresco >= REFRESCO_PANTALLA_MS) {
    pantallaMostrar(lecturas);
    ultimoRefresco = millis();
  }
}
