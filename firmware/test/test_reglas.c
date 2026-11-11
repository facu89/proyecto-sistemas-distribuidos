// Tests de src/reglas.c, los mismos casos que software/servicio/src/reglas.test.ts.
// Se corren en la computadora (no en la placa): ver test/README.

#include <math.h>
#include <stdio.h>

#include "../src/reglas.h"

static int fallas = 0, pruebas = 0;

#define ES(esperado, obtenido, descripcion)                                                       \
  do {                                                                                          \
    pruebas++;                                                                                  \
    if ((esperado) != (obtenido)) {                                                             \
      fallas++;                                                                                 \
      printf("FALLA: %s (esperaba %d, dio %d)\n", descripcion, (int)(esperado), (int)(obtenido)); \
    }                                                                                           \
  } while (0)

int main(void) {
  Rangos r = rangosPorDefecto();

  // Riego: prende < 20 %, apaga >= 70 %
  ES(1, decidirRiego(19, false, &r), "riego prende debajo de 20");
  ES(0, decidirRiego(20, false, &r), "20 justo no prende si estaba apagado");
  ES(1, decidirRiego(50, true, &r), "entre 20 y 70 sigue regando si regaba");
  ES(0, decidirRiego(50, false, &r), "entre 20 y 70 sigue apagado si estaba apagado");
  ES(0, decidirRiego(70, true, &r), "apaga en 70");
  ES(-1, decidirRiego(NAN, true, &r), "nan no decide");

  // Cooler: prende >= 28 °C, apaga < 26 °C
  ES(1, decidirCooler(28, false, &r), "cooler prende en 28");
  ES(0, decidirCooler(27, false, &r), "27 no lo prende si estaba apagado");
  ES(1, decidirCooler(26, true, &r), "26 lo mantiene si estaba prendido");
  ES(0, decidirCooler(25.9f, true, &r), "apaga debajo de 26");
  ES(-1, decidirCooler(NAN, false, &r), "nan no decide");

  // Luz sin horario
  ES(0, decidirLuz(true, 720, &r), "con luz apaga");
  ES(1, decidirLuz(false, 720, &r), "a oscuras prende");

  // Luz con horario 18:00 a 23:00
  r.luzConHorario = true;
  r.luzDesde = 18 * 60;
  r.luzHasta = 23 * 60;
  ES(1, decidirLuz(false, 20 * 60, &r), "a oscuras dentro del horario prende");
  ES(0, decidirLuz(false, 2 * 60, &r), "a oscuras fuera del horario no prende");
  ES(1, decidirLuz(false, 18 * 60, &r), "justo al empezar prende");
  ES(0, decidirLuz(false, 23 * 60, &r), "justo al terminar apaga");
  ES(1, decidirLuz(false, -1, &r), "sin hora (sin NTP) ignora el horario y prende a oscuras");
  ES(1, dentroDelHorario(23 * 60, 22 * 60, 6 * 60), "horario que cruza la medianoche: 23:00");
  ES(1, dentroDelHorario(3 * 60, 22 * 60, 6 * 60), "horario que cruza la medianoche: 03:00");
  ES(0, dentroDelHorario(12 * 60, 22 * 60, 6 * 60), "horario que cruza la medianoche: 12:00");

  // Validación (los mismos márgenes que el servicio)
  Rangos v = rangosPorDefecto();
  ES(1, rangosProblema(&v) == NULL, "los valores por defecto son válidos");
  v.riegoPrendeBajo = 30; v.riegoApagaDesde = 35;
  ES(1, rangosProblema(&v) == NULL, "riego con 5 puntos de margen vale");
  v.riegoApagaDesde = 34;
  ES(0, rangosProblema(&v) == NULL, "riego con 4 puntos no vale");
  v = rangosPorDefecto(); v.coolerPrendeDesde = 30; v.coolerApagaBajo = 29;
  ES(0, rangosProblema(&v) == NULL, "cooler con 1 grado no vale");
  v = rangosPorDefecto(); v.luzConHorario = true; v.luzDesde = 600; v.luzHasta = 600;
  ES(0, rangosProblema(&v) == NULL, "horario que empieza y termina igual no vale");

  printf("%d pruebas, %d fallas\n", pruebas, fallas);
  return fallas == 0 ? 0 : 1;
}
