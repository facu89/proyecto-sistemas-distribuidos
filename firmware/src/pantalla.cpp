#include "pantalla.h"

#include <SSD1306Wire.h>

#include "config.h"
#include "pines.h"

namespace {

SSD1306Wire display(0x3c, PIN_OLED_SDA, PIN_OLED_SCL, GEOMETRY_128_64);

String formatear(float valor, unsigned int decimales, const char *unidad) {
  if (isnan(valor)) return "--";
  return String(valor, decimales) + unidad;
}

// Una fila: etiqueta a la izquierda y valor alineado a la derecha.
void fila(int16_t y, const char *etiqueta, const String &valor) {
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.drawString(0, y, etiqueta);
  display.setTextAlignment(TEXT_ALIGN_RIGHT);
  display.drawString(128, y, valor);
}

const char *textoRed(EstadoRed red) {
  switch (red) {
    case EstadoRed::Conectado:
      return "MQTT ok";
    case EstadoRed::SinBroker:
      return "sin MQTT";
    default:
      return "sin WiFi";
  }
}

String textoOrden(const Orden &orden) {
  if (!orden.hay) return "sin órdenes";
  return String(orden.tipo) + ": " + orden.valor;
}

}  // namespace

void pantallaIniciar() {
  pinMode(PIN_VEXT, OUTPUT);
  digitalWrite(PIN_VEXT, LOW);
  delay(100);

  pinMode(PIN_OLED_RST, OUTPUT);
  digitalWrite(PIN_OLED_RST, LOW);
  delay(20);
  digitalWrite(PIN_OLED_RST, HIGH);
  delay(20);

  display.init();
  // Si el texto aparece invertido, descomentá esta línea.
  // display.flipScreenVertically();
  display.clear();
  display.setFont(ArialMT_Plain_16);
  display.drawString(0, 24, "Iniciando...");
  display.display();
}

// Cinco filas de 13 px: nodoId y antigüedad, suelo, aire y luz, y la última orden con el estado de la red.
void pantallaMostrar(const Lecturas &lecturas, EstadoRed red, const Orden &orden) {
  display.clear();

  display.setFont(ArialMT_Plain_10);
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.drawString(0, 0, NODO_ID);
  if (lecturas.hayDatos) {
    unsigned long segundos = (millis() - lecturas.instante) / 1000;
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    display.drawString(128, 0, "hace " + String(segundos) + " s");
  }

  if (lecturas.hayDatos) {
    // Temperatura y humedad de cada medio en la misma fila.
    fila(13, "Suelo", formatear(lecturas.temperaturaSuelo, 1, " °C") + "   " +
                          formatear(lecturas.humedadSuelo, 0, " %"));
    fila(26, "Aire", formatear(lecturas.temperaturaAire, 1, " °C") + "   " +
                         formatear(lecturas.humedadAire, 0, " %"));
    fila(39, "Luz", lecturas.hayLuz ? "sí" : "no");
  } else {
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.drawString(0, 26, "Leyendo...");
  }

  fila(52, textoOrden(orden).c_str(), textoRed(red));

  display.display();
}
