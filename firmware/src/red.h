#pragma once

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
bool redActualizar(Orden &orden);

EstadoRed redEstado();

// Publica cada lectura en {nodoId}/sensor/{tipo}. Un sensor que no respondió se publica como "nan".
void redPublicarLecturas(const Lecturas &lecturas);
