#pragma once

#include <stddef.h>

// Actuadores del nodo. Cada uno se identifica por su {tipo}, el mismo nombre que va en el tópico
// {nodoId}/actuador/{tipo}/cmd. Arrancan todos apagados.

void actuadoresIniciar();

// Aplica una orden: "1" u "on" prende, "0" u "off" apaga (sin distinguir mayúsculas).
// Devuelve el índice del actuador, o -1 si el tipo no existe o el valor no se entiende.
int actuadoresAplicar(const char *tipo, const char *valor);

size_t actuadoresCantidad();
const char *actuadorTipo(size_t indice);
bool actuadorPrendido(size_t indice);
