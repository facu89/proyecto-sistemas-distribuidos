#include "sensores.h"

#include <DHT.h>
#include <DallasTemperature.h>
#include <OneWire.h>

#include "pines.h"

namespace {

constexpr unsigned long INTERVALO_MS = 5000;  // una medición (y una publicación) cada 5 s; el DHT11 admite como mínimo 1 s
constexpr unsigned long CONVERSION_MS = 750;  // conversión de la DS18B20 a 12 bits

// Calibración de la sonda de suelo: lectura cruda con la sonda seca al aire (0 %) y metida en
// agua (100 %). La sonda y la resistencia a GND forman un divisor: a más agua, menos resistencia
// en la sonda y más tensión en PIN_HUMEDAD_SUELO. Se miden con el monitor serie.
constexpr int SUELO_SECO = 0;
constexpr int SUELO_MOJADO = 2100;
constexpr int MUESTRAS_SUELO = 8;  // se promedian para bajar el ruido del ADC
// La sonda se alimenta solo durante la medición: con corriente continua todo el tiempo, las puntas
// se corroen por electrólisis. Antes de leer se espera a que la tensión se estabilice.
constexpr unsigned long ESTABILIZACION_SUELO_MS = 10;

// El DO del módulo LDR queda en LOW cuando hay más luz que el umbral. Si da al revés, cambiar a HIGH.
constexpr int LUZ_ACTIVA = LOW;

OneWire oneWire(PIN_DS18B20);
DallasTemperature ds18b20(&oneWire);
DHT dht(PIN_DHT, DHT11);

bool convirtiendo = false;
bool primeraVez = true;
unsigned long inicioConversion = 0;

int leerSueloCrudo() {
  digitalWrite(PIN_ALIMENTACION_SUELO, HIGH);
  delay(ESTABILIZACION_SUELO_MS);
  long suma = 0;
  for (int i = 0; i < MUESTRAS_SUELO; i++) suma += analogRead(PIN_HUMEDAD_SUELO);
  digitalWrite(PIN_ALIMENTACION_SUELO, LOW);
  return suma / MUESTRAS_SUELO;
}

float porcentajeSuelo(int crudo) {
  float porcentaje = 100.0f * (SUELO_SECO - crudo) / (SUELO_SECO - SUELO_MOJADO);
  return constrain(porcentaje, 0.0f, 100.0f);
}

}  // namespace

void sensoresIniciar() {
  ds18b20.begin();
  ds18b20.setWaitForConversion(false);
  dht.begin();
  pinMode(PIN_LUZ, INPUT);  // el módulo trae su pull-up
  pinMode(PIN_ALIMENTACION_SUELO, OUTPUT);
  digitalWrite(PIN_ALIMENTACION_SUELO, LOW);
  analogReadResolution(12);
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

  // Cuando la conversión terminó, se leen todos los sensores juntos.
  if (ahora - inicioConversion < CONVERSION_MS) return false;
  convirtiendo = false;

  float suelo = ds18b20.getTempCByIndex(0);
  lecturas.temperaturaSuelo = (suelo == DEVICE_DISCONNECTED_C) ? NAN : suelo;
  lecturas.temperaturaAire = dht.readTemperature();
  lecturas.humedadAire = dht.readHumidity();
  lecturas.humedadSueloCruda = leerSueloCrudo();
  lecturas.humedadSuelo = porcentajeSuelo(lecturas.humedadSueloCruda);
  lecturas.hayLuz = digitalRead(PIN_LUZ) == LUZ_ACTIVA;
  lecturas.instante = ahora;
  lecturas.hayDatos = true;
  return true;
}
