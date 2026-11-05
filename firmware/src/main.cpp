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
  Serial.printf("suelo=%.1f C %.0f %% (crudo %d)  aire=%.1f C %.0f %%  luz=%d\n",
                l.temperaturaSuelo, l.humedadSuelo, l.humedadSueloCruda,
                l.temperaturaAire, l.humedadAire, l.hayLuz);
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
