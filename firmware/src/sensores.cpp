#include "sensores.h"

#include <DHT.h>
#include <DallasTemperature.h>
#include <OneWire.h>

#include "pines.h"

namespace {

constexpr unsigned long INTERVALO_MS = 5000;  // una medición (y una publicación) cada 5 s; el DHT11 admite como mínimo 1 s
constexpr unsigned long CONVERSION_MS = 750;  // conversión de la DS18B20 a 12 bits

OneWire oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);
DHT dht(PIN_DHT, DHT11);

bool convirtiendo = false;
bool primeraVez = true;
unsigned long inicioConversion = 0;

}  // namespace

void sensoresIniciar() {
  ds18b20.begin();
  ds18b20.setWaitForConversion(false);
  dht.begin();
  Serial.printf("DS18B20 encontradas: %u\n", ds18b20.getDeviceCount());
}

bool sensoresActualizar(Lecturas &lecturas) {
  unsigned long ahora = millis();

  // Primero se pide la conversión a la DS18B20 y se sigue con el loop.
  if (!convirtiendo) {
    if (!primeraVez && ahora - inicioConversion < INTERVALO_MS) return false;
    ds18b20.requestTemperatures();
    inicioConversion = ahora;
    convirtiendo = true;
    primeraVez = false;
    return false;
  }

  // Cuando la conversión terminó, se leen los dos sensores juntos.
  if (ahora - inicioConversion < CONVERSION_MS) return false;
  convirtiendo = false;

  float suelo = ds18b20.getTempCByIndex(0);
  lecturas.temperaturaSuelo = (suelo == DEVICE_DISCONNECTED_C) ? NAN : suelo;
  lecturas.temperaturaAire = dht.readTemperature();
  lecturas.humedadAire = dht.readHumidity();
  lecturas.instante = ahora;
  lecturas.hayDatos = true;
  return true;
}
