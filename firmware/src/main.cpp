#include <Arduino.h>
#include <time.h>

#include "actuadores.h"
#include "configuracion.h"
#include "pantalla.h"
#include "red.h"
#include "reglas.h"
#include "sensores.h"

// Las reglas de los actuadores corren acá, en el bancal (reglas.c): así sigue regando, ventilando y
// prendiendo la luz aunque se caiga el servicio, el broker o internet. El servicio solo manda la
// configuración (modo y rangos, en {nodoId}/config) y, en manual, las órdenes de la web.
//
// Modo efectivo: el que configuró la web mientras el servicio esté en línea. Si el servicio se cae (o se
// pierde el broker), el bancal pasa a automático en el acto: en manual nadie podría manejarlo.

namespace {

constexpr unsigned long REFRESCO_PANTALLA_MS = 500;  // para que el "hace N s" avance

Lecturas lecturas;
Orden orden;
ConfigBancal config;
PulsoRiego pulso;
// El riego "quiere agua" desde que la humedad baja del umbral hasta que llega al de apagar (histéresis):
// mientras tanto riega de a pulsos. No es el estado del relé, que se prende y apaga en cada pulso.
bool quiereAgua = false;
Modo efectivoAnterior = Modo::Automatico;
unsigned long ultimoRefresco = 0;
bool estabaConectado = false;

Modo modoEfectivo() { return redServicioConectado() ? config.modo : Modo::Automatico; }

// Hora local en minutos desde la medianoche, o -1 si todavía no se sincronizó por NTP.
int minutoLocal() {
  struct tm ahora;
  if (!getLocalTime(&ahora, 0) || ahora.tm_year < 2024 - 1900) return -1;
  return ahora.tm_hour * 60 + ahora.tm_min;
}

void configurarHora() {
  // Empieza a sincronizar apenas haya red (y cada hora); mientras tanto el horario de la luz se ignora.
  configTzTime(config.zona, "pool.ntp.org", "time.google.com");
}

void publicarAplicada() {
  char json[128];
  configResumen(config, modoEfectivo(), json, sizeof json);
  redPublicarConfigAplicada(json);
}

// Prende o apaga según la decisión (1, 0 o -1 = no tocar) y publica el estado si cambió.
void poner(const char *tipo, int decision, const char *motivo) {
  int indice = actuadorIndice(tipo);
  if (indice < 0 || decision < 0 || actuadorPrendido(indice) == (decision == 1)) return;
  actuadoresAplicar(tipo, decision == 1 ? "1" : "0");
  Serial.printf("Regla: %s -> %d (%s)\n", tipo, decision, motivo);
  redPublicarEstado(tipo, decision == 1);
}

void prenderBomba(const char *motivo) {
  pulsoEmpezar(&pulso, millis());
  actuadoresAplicar("riego", "1");
  Serial.printf("Riego: pulso de %d s (%s)\n", config.rangos.riegoPulsoS, motivo);
  redPublicarEstado("riego", true);
}

void apagarBomba(const char *motivo) {
  actuadoresAplicar("riego", "0");
  Serial.printf("Riego: bomba apagada (%s); espera %d lecturas\n", motivo, pulso.esperaRestante);
  redPublicarEstado("riego", false);
}

// Riego por pulsos: mientras quiera agua, un pulso cada vez que termina la espera.
void aplicarRiego(const char *motivo) {
  int decision = decidirRiego(lecturas.humedadSuelo, quiereAgua, &config.rangos);
  if (decision >= 0) quiereAgua = decision == 1;
  if (!quiereAgua && pulso.regando) {
    pulsoCortar(&pulso, &config.rangos);
    apagarBomba("llegó a la humedad buscada");
  } else if (quiereAgua && pulsoPuedeEmpezar(&pulso)) {
    prenderBomba(motivo);
  }
}

void aplicarReglas(const char *motivo) {
  if (!lecturas.hayDatos) return;
  const Rangos &r = config.rangos;
  aplicarRiego(motivo);
  poner("cooler", decidirCooler(lecturas.temperaturaAire, actuadorPrendido(actuadorIndice("cooler")), &r), motivo);
  poner("luz", decidirLuz(lecturas.hayLuz, minutoLocal(), &r), motivo);
}

void ejecutar(const Orden &o) {
  if (modoEfectivo() != Modo::Manual) {
    Serial.printf("Orden ignorada (%s -> %s): el bancal está en automático\n", o.tipo, o.valor);
    return;
  }
  // El riego también va por pulsos en manual: "1" riega un pulso (si no está esperando), "0" lo corta
  if (strcmp(o.tipo, "riego") == 0 || strcmp(o.tipo, "bomba") == 0) {
    if (strcmp(o.valor, "1") == 0) {
      if (pulsoPuedeEmpezar(&pulso)) {
        prenderBomba("orden manual");
      } else {
        Serial.printf("Riego: orden ignorada, %s\n", pulso.regando ? "ya está regando" : "esperando que el agua llegue al sensor");
        redPublicarEstado("riego", pulso.regando);  // para que la web vuelva a mostrar el estado real
      }
    } else if (strcmp(o.valor, "0") == 0 && pulso.regando) {
      pulsoCortar(&pulso, &config.rangos);
      apagarBomba("orden manual");
    }
    return;
  }
  int indice = actuadoresAplicar(o.tipo, o.valor);
  if (indice < 0) {
    Serial.printf("Orden ignorada: actuador \"%s\" o valor \"%s\" desconocido\n", o.tipo, o.valor);
    return;
  }
  redPublicarEstado(actuadorTipo(indice), actuadorPrendido(indice));
}

void atenderConfig() {
  char json[400];
  if (!redConfigNueva(json, sizeof json)) return;
  ConfigBancal nueva = config;
  const char *problema = configInterpretar(json, nueva);
  if (problema) {
    Serial.printf("Configuración rechazada: %s\n", problema);
    return;
  }
  bool otraZona = strcmp(nueva.zona, config.zona) != 0;
  config = nueva;
  configGuardar(config);
  if (otraZona) configurarHora();
  Serial.printf("Configuración v%llu: modo %s, riego %.0f/%.0f %% (pulsos de %d s, espera %d lecturas), cooler %.1f/%.1f C, luz %s\n",
                (unsigned long long)config.version, modoNombre(config.modo), config.rangos.riegoPrendeBajo,
                config.rangos.riegoApagaDesde, config.rangos.riegoPulsoS, config.rangos.riegoEsperaLecturas,
                config.rangos.coolerPrendeDesde, config.rangos.coolerApagaBajo,
                config.rangos.luzConHorario ? "con horario" : "sin horario");
  publicarAplicada();
  if (modoEfectivo() == Modo::Automatico) aplicarReglas("configuración nueva");
}

// Si cambia el modo efectivo (el servicio se cayó o volvió, o llegó otro modo), se avisa y, al pasar a
// automático, se aplican las reglas enseguida con las últimas lecturas.
void revisarModo() {
  Modo efectivo = modoEfectivo();
  if (efectivo == efectivoAnterior) return;
  if (efectivo == Modo::Automatico && config.modo == Modo::Manual) {
    Serial.println("Sin servicio: el bancal pasa a automático hasta que vuelva");
  } else {
    Serial.printf("Modo efectivo: %s\n", modoNombre(efectivo));
  }
  efectivoAnterior = efectivo;
  publicarAplicada();
  if (efectivo == Modo::Automatico) aplicarReglas("pasa a automático");
}

// Al (re)conectar se publican todos los estados y la configuración en uso: pisan lo retenido si algo
// cambió sin conexión.
void publicarAlConectar() {
  bool conectado = redEstado() == EstadoRed::Conectado;
  if (conectado && !estabaConectado) {
    for (size_t i = 0; i < actuadoresCantidad(); i++) {
      redPublicarEstado(actuadorTipo(i), actuadorPrendido(i));
    }
    publicarAplicada();
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
  config = configCargar();
  pulsoIniciar(&pulso);
  Serial.printf("Configuración guardada: v%llu, modo %s\n", (unsigned long long)config.version,
                modoNombre(config.modo));
  redIniciar();
  configurarHora();
}

void loop() {
  bool nuevas = sensoresActualizar(lecturas);
  if (nuevas) {
    imprimir(lecturas);
    redPublicarLecturas(lecturas);
    pulsoNuevaLectura(&pulso);
  }
  // El pulso de riego se corta por tiempo, en cualquier modo y aunque no haya red
  if (pulsoVencio(&pulso, millis(), &config.rangos)) apagarBomba("terminó el pulso");

  bool ordenNueva = redActualizar(orden);
  atenderConfig();
  revisarModo();
  if (ordenNueva) ejecutar(orden);
  if (nuevas && modoEfectivo() == Modo::Automatico) aplicarReglas("lectura");
  publicarAlConectar();

  // El refresco periódico también muestra los cambios de estado de la red.
  if (nuevas || ordenNueva || millis() - ultimoRefresco >= REFRESCO_PANTALLA_MS) {
    pantallaMostrar(lecturas, redEstado(), orden);
    ultimoRefresco = millis();
  }
}
