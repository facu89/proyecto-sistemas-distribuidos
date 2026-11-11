#include "configuracion.h"

#include <ArduinoJson.h>
#include <Preferences.h>
#include <stdio.h>
#include <string.h>

namespace {

constexpr const char *ESPACIO = "bancal";  // espacio de nombres en NVS
constexpr const char *CLAVE = "config";
// Si cambia la forma de ConfigBancal, cambia el tamaño y lo guardado antes se descarta (vuelve al defecto).

// "18:30" -> 1110; -1 si no es una hora válida
int aMinutos(const char *hora) {
  int h, m;
  char resto;
  if (!hora || sscanf(hora, "%2d:%2d%c", &h, &m, &resto) != 2) return -1;
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

}  // namespace

const char *modoNombre(Modo modo) { return modo == Modo::Manual ? "manual" : "automatico"; }

ConfigBancal configCargar() {
  ConfigBancal config;
  Preferences nvs;
  if (nvs.begin(ESPACIO, true)) {
    if (nvs.getBytesLength(CLAVE) == sizeof(ConfigBancal)) {
      ConfigBancal guardada;
      nvs.getBytes(CLAVE, &guardada, sizeof guardada);
      guardada.zona[sizeof guardada.zona - 1] = '\0';
      if (rangosProblema(&guardada.rangos) == nullptr) config = guardada;
    }
    nvs.end();
  }
  return config;
}

void configGuardar(const ConfigBancal &config) {
  Preferences nvs;
  if (!nvs.begin(ESPACIO, false)) return;
  nvs.putBytes(CLAVE, &config, sizeof config);
  nvs.end();
}

const char *configInterpretar(const char *json, ConfigBancal &salida) {
  JsonDocument doc;
  if (deserializeJson(doc, json)) return "no es JSON";

  ConfigBancal nueva;
  nueva.version = doc["v"] | (uint64_t)0;
  const char *modo = doc["modo"] | "";
  if (strcmp(modo, "manual") == 0) nueva.modo = Modo::Manual;
  else if (strcmp(modo, "automatico") == 0) nueva.modo = Modo::Automatico;
  else return "modo desconocido";

  JsonArray riego = doc["riego"], cooler = doc["cooler"];
  if (riego.size() != 2 || cooler.size() != 2) return "faltan los rangos de riego o cooler";
  nueva.rangos.riegoPrendeBajo = riego[0].as<float>();
  nueva.rangos.riegoApagaDesde = riego[1].as<float>();
  nueva.rangos.coolerPrendeDesde = cooler[0].as<float>();
  nueva.rangos.coolerApagaBajo = cooler[1].as<float>();

  JsonArray pulso = doc["pulso"];
  if (pulso.size() == 2) {
    nueva.rangos.riegoPulsoS = pulso[0].as<int>();
    nueva.rangos.riegoEsperaLecturas = pulso[1].as<int>();
  }

  JsonVariant luz = doc["luz"];
  if (luz.isNull()) {
    nueva.rangos.luzConHorario = false;
  } else {
    JsonArray horario = luz.as<JsonArray>();
    nueva.rangos.luzConHorario = true;
    nueva.rangos.luzDesde = aMinutos(horario[0] | "");
    nueva.rangos.luzHasta = aMinutos(horario[1] | "");
  }

  const char *zona = doc["tz"] | "<-03>3";
  strncpy(nueva.zona, zona, sizeof nueva.zona - 1);
  nueva.zona[sizeof nueva.zona - 1] = '\0';

  const char *problema = rangosProblema(&nueva.rangos);
  if (problema) return problema;
  salida = nueva;
  return nullptr;
}

void configResumen(const ConfigBancal &config, Modo efectivo, char *destino, size_t tamano) {
  snprintf(destino, tamano, "{\"v\":%llu,\"modo\":\"%s\",\"efectivo\":\"%s\"}",
           (unsigned long long)config.version, modoNombre(config.modo), modoNombre(efectivo));
}
