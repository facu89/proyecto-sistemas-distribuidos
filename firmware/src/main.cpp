#include <Arduino.h>

#include "actuadores.h"
#include "pantalla.h"
#include "red.h"
#include "sensores.h"

namespace {

constexpr unsigned long REFRESCO_PANTALLA_MS = 500;  // para que el "hace N s" avance

Lecturas lecturas;
Orden orden;
unsigned long ultimoRefresco = 0;
bool estabaConectado = false;

void ejecutar(const Orden &o) {
  int indice = actuadoresAplicar(o.tipo, o.valor);
  if (indice < 0) {
    Serial.printf("Orden ignorada: actuador \"%s\" o valor \"%s\" desconocido\n", o.tipo, o.valor);
    return;
  }
  redPublicarEstado(actuadorTipo(indice), actuadorPrendido(indice));
}

// Al (re)conectar se publican todos los estados: pisa lo retenido si cambió algo sin conexión.
void publicarEstadosAlConectar() {
  bool conectado = redEstado() == EstadoRed::Conectado;
  if (conectado && !estabaConectado) {
    for (size_t i = 0; i < actuadoresCantidad(); i++) {
      redPublicarEstado(actuadorTipo(i), actuadorPrendido(i));
    }
  }
  estabaConectado = conectado;
}

void imprimir(const Lecturas &l) {
  Serial.printf("suelo=%.1f C %.0f %% (crudo %d)  aire=%.1f C %.0f %%  luz=%d\n",
                l.temperaturaSuelo, l.humedadSuelo, l.humedadSueloCruda,
                l.temperaturaAire, l.humedadAire, l.hayLuz);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  // Antes que la pantalla: pantallaIniciar() prende Ve, que alimenta la lógica del módulo de 2 relés
  // (activo en LOW). Con los pines ya en apagado, el cooler no arranca un instante al encender.
  actuadoresIniciar();
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
  if (ordenNueva) ejecutar(orden);
  publicarEstadosAlConectar();

  // El refresco periódico también muestra los cambios de estado de la red.
  if (nuevas || ordenNueva || millis() - ultimoRefresco >= REFRESCO_PANTALLA_MS) {
    pantallaMostrar(lecturas, redEstado(), orden);
    ultimoRefresco = millis();
  }
}
