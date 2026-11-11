#pragma once

#include <stddef.h>

#include "sensores.h"

enum class EstadoRed { SinWifi, SinBroker, Conectado };

// Última orden recibida en {nodoId}/actuador/{tipo}/cmd
struct Orden {
  char tipo[24] = "";
  char valor[16] = "";
  unsigned long instante = 0;  // millis() en que llegó
  bool hay = false;            // false hasta la primera orden
};

// Conecta al WiFi y prepara el cliente MQTT (que arranca cuando hay WiFi).
void redIniciar();

// Atiende la red sin bloquear. Devuelve true si llegó una orden nueva, y la deja en `orden`.
// Entrega una orden por llamada: si llegaron varias, las siguientes salen en las próximas vueltas.
bool redActualizar(Orden &orden);

EstadoRed redEstado();

// Configuración nueva llegada en {nodoId}/config (JSON, retenido, la publica el servicio). La deja en
// `json` y devuelve true; una por llamada.
bool redConfigNueva(char *json, size_t tamano);

// Si el servicio está en línea: conectados al broker y el último "servicio/conexion" fue "online".
// Si el servicio se cae, su Last Will publica "offline"; si se cae el broker, perdemos la conexión.
bool redServicioConectado();

// Publica en {nodoId}/config/aplicada (retenido) qué configuración se está usando y el modo efectivo.
void redPublicarConfigAplicada(const char *json);

// Publica el estado real de un actuador en {nodoId}/actuador/{tipo}/estado ("1" o "0", retenido).
// Sin conexión no hace nada.
void redPublicarEstado(const char *tipo, bool prendido);

// Publica cada lectura en {nodoId}/sensor/{tipo}. Un sensor que no respondió se publica como "nan".
void redPublicarLecturas(const Lecturas &lecturas);
