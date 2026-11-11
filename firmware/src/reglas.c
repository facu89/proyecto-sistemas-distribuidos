#include "reglas.h"

#include <math.h>
#include <stddef.h>

Rangos rangosPorDefecto(void) {
  Rangos r = {20.0f, 70.0f, 28.0f, 26.0f, false, 0, 0};
  return r;
}

static bool numero(float v) { return !isnan(v) && !isinf(v); }

const char *rangosProblema(const Rangos *r) {
  if (!numero(r->riegoPrendeBajo) || !numero(r->riegoApagaDesde) || !numero(r->coolerPrendeDesde) ||
      !numero(r->coolerApagaBajo)) {
    return "los umbrales tienen que ser numeros";
  }
  if (r->riegoPrendeBajo < 0 || r->riegoApagaDesde > 100) return "la humedad va de 0 a 100 %";
  if (r->riegoApagaDesde - r->riegoPrendeBajo < MARGEN_RIEGO) return "el riego necesita 5 puntos entre prender y apagar";
  if (r->coolerApagaBajo < 0 || r->coolerPrendeDesde > 50) return "la temperatura va de 0 a 50 C";
  if (r->coolerPrendeDesde - r->coolerApagaBajo < MARGEN_COOLER) return "el cooler necesita 2 C entre prender y apagar";
  if (r->luzConHorario) {
    if (r->luzDesde < 0 || r->luzDesde >= 1440 || r->luzHasta < 0 || r->luzHasta >= 1440) return "horario fuera de rango";
    if (r->luzDesde == r->luzHasta) return "el horario tiene que empezar y terminar a distinta hora";
  }
  return NULL;
}

bool dentroDelHorario(int minuto, int desde, int hasta) {
  return desde < hasta ? (minuto >= desde && minuto < hasta) : (minuto >= desde || minuto < hasta);
}

// Entre los dos umbrales se mantiene el estado actual (histéresis).
static int conHisteresis(bool prender, bool apagar, bool actual) {
  if (prender) return 1;
  if (apagar) return 0;
  return actual ? 1 : 0;
}

int decidirRiego(float humedadSuelo, bool actual, const Rangos *r) {
  if (!numero(humedadSuelo)) return -1;
  return conHisteresis(humedadSuelo < r->riegoPrendeBajo, humedadSuelo >= r->riegoApagaDesde, actual);
}

int decidirCooler(float temperaturaAire, bool actual, const Rangos *r) {
  if (!numero(temperaturaAire)) return -1;
  return conHisteresis(temperaturaAire >= r->coolerPrendeDesde, temperaturaAire < r->coolerApagaBajo, actual);
}

int decidirLuz(bool hayLuz, int minutoLocal, const Rangos *r) {
  if (hayLuz) return 0;
  if (!r->luzConHorario || minutoLocal < 0) return 1;
  return dentroDelHorario(minutoLocal, r->luzDesde, r->luzHasta) ? 1 : 0;
}
