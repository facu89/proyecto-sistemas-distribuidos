#pragma once

#include <stddef.h>

// Actuadores del nodo. Cada uno se identifica por su {tipo}, el mismo nombre que va en el tópico
// {nodoId}/actuador/{tipo}/cmd. Arrancan todos apagados.

void actuadoresIniciar();

// Aplica una orden: "1" prende, "0" apaga.
// Devuelve el índice del actuador, o -1 si el tipo no existe o el valor no se entiende.
int actuadoresAplicar(const char *tipo, const char *valor);

size_t actuadoresCantidad();
// Índice del actuador de ese tipo, o -1 si no existe.
int actuadorIndice(const char *tipo);
const char *actuadorTipo(size_t indice);
bool actuadorPrendido(size_t indice);
