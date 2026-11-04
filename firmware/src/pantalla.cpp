#include "pantalla.h"

#include <SSD1306Wire.h>

#include "pines.h"

namespace {

constexpr const char *TITULO = "Planta 1";

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

void pantallaMostrar(const Lecturas &lecturas) {
  display.clear();

  display.setFont(ArialMT_Plain_10);
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.drawString(0, 0, TITULO);
  if (lecturas.hayDatos) {
    unsigned long segundos = (millis() - lecturas.instante) / 1000;
    display.setTextAlignment(TEXT_ALIGN_RIGHT);
    display.drawString(128, 0, "hace " + String(segundos) + " s");
  }

  display.setFont(ArialMT_Plain_16);
  if (lecturas.hayDatos) {
    fila(12, "Suelo", formatear(lecturas.temperaturaSuelo, 1, " °C"));
    fila(29, "Aire", formatear(lecturas.temperaturaAire, 1, " °C"));
    fila(46, "Humedad", formatear(lecturas.humedadAire, 0, " %"));
  } else {
    display.setTextAlignment(TEXT_ALIGN_LEFT);
    display.drawString(0, 24, "Leyendo...");
  }

  display.display();
}
