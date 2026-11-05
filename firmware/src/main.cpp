#include <Arduino.h>

#include "pantalla.h"
#include "red.h"
#include "sensores.h"

namespace {

constexpr unsigned long REFRESCO_PANTALLA_MS = 500;  // para que el "hace N s" avance

Lecturas lecturas;
Orden orden;
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
  redIniciar();
}

void loop() {
  bool nuevas = sensoresActualizar(lecturas);
  if (nuevas) {
    imprimir(lecturas);
    redPublicarLecturas(lecturas);
  }

  bool ordenNueva = redActualizar(orden);

  // El refresco periódico también muestra los cambios de estado de la red.
  if (nuevas || ordenNueva || millis() - ultimoRefresco >= REFRESCO_PANTALLA_MS) {
    pantallaMostrar(lecturas, redEstado(), orden);
    ultimoRefresco = millis();
  }
}
