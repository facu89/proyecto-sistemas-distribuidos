#include "red.h"

#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <mqtt_client.h>

#include <atomic>
#include <cstring>

#if __has_include("config.h")
#include "config.h"
#else
#error "Falta include/config.h: copiá include/config.example.h como config.h y completalo"
#endif

// El cliente de esp-mqtt corre en su propia tarea de FreeRTOS. Sus eventos (conexión, mensajes)
// llegan en esa tarea, no en loop(). Por eso lo que se comparte con loop() pasa por un
// std::atomic (el estado de conexión) o por una cola (las órdenes).

namespace {

constexpr int KEEPALIVE_S = 10;  // PING cada ~5 s (la mitad); sin noticias por 1,5 × 10 = 15 s, el broker publica el Last Will
constexpr int RECONEXION_MS = 5000;
constexpr int QOS_LECTURAS = 0;
constexpr int QOS_PRESENCIA = 1;
constexpr int QOS_ORDENES = 1;
constexpr const char *SUFIJO_ORDEN = "/cmd";

esp_mqtt_client_handle_t cliente = nullptr;
bool mqttIniciado = false;
std::atomic<bool> conectado{false};
QueueHandle_t colaOrdenes = nullptr;

// Último error informado por esp-mqtt, para mostrar el motivo de una desconexión por Serial.
std::atomic<int> errorTipo{MQTT_ERROR_TYPE_NONE};
std::atomic<int> errorCodigoConexion{0};
std::atomic<int> errorSocket{0};

char topicoPresencia[64];  // {nodoId}/presencia
char filtroOrdenes[64];    // {nodoId}/actuador/+/cmd
char prefijoOrdenes[64];   // {nodoId}/actuador/

void copiar(char *destino, size_t tamano, const char *origen, size_t largo) {
  if (largo >= tamano) largo = tamano - 1;
  memcpy(destino, origen, largo);
  destino[largo] = '\0';
}

// Corre en la tarea de MQTT: solo extrae {tipo} y el valor, y lo deja en la cola para loop().
void encolarOrden(const esp_mqtt_event_t &evento) {
  // Un mensaje más grande que el buffer llega en varios pedazos. Una orden es "on"/"off": se descarta.
  if (evento.current_data_offset != 0 || evento.data_len != evento.total_data_len) return;

  size_t largoPrefijo = strlen(prefijoOrdenes);
  size_t largoSufijo = strlen(SUFIJO_ORDEN);
  size_t largoTopico = evento.topic_len;
  if (largoTopico <= largoPrefijo + largoSufijo) return;
  if (memcmp(evento.topic, prefijoOrdenes, largoPrefijo) != 0) return;
  if (memcmp(evento.topic + largoTopico - largoSufijo, SUFIJO_ORDEN, largoSufijo) != 0) return;

  Orden orden;
  copiar(orden.tipo, sizeof orden.tipo, evento.topic + largoPrefijo,
         largoTopico - largoPrefijo - largoSufijo);
  copiar(orden.valor, sizeof orden.valor, evento.data, evento.data_len);
  xQueueSend(colaOrdenes, &orden, 0);  // si la cola está llena, la orden se pierde
}

void alEvento(void *, esp_event_base_t, int32_t id, void *datos) {
  auto *evento = static_cast<esp_mqtt_event_handle_t>(datos);
  switch (static_cast<esp_mqtt_event_id_t>(id)) {
    case MQTT_EVENT_CONNECTED:
      errorTipo = MQTT_ERROR_TYPE_NONE;
      conectado = true;
      // Pisa el "offline" retenido que pudo haber dejado el Last Will de una caída anterior.
      esp_mqtt_client_publish(cliente, topicoPresencia, "online", 0, QOS_PRESENCIA, 1);
      esp_mqtt_client_subscribe(cliente, filtroOrdenes, QOS_ORDENES);
      break;
    case MQTT_EVENT_DISCONNECTED:
      conectado = false;
      break;
    case MQTT_EVENT_DATA:
      encolarOrden(*evento);
      break;
    case MQTT_EVENT_ERROR:
      if (evento->error_handle) {
        errorTipo = evento->error_handle->error_type;
        errorCodigoConexion = evento->error_handle->connect_return_code;
        errorSocket = evento->error_handle->esp_transport_sock_errno;
      }
      break;
    default:
      break;
  }
}

void imprimirMotivo() {
  switch (errorTipo.load()) {
    case MQTT_ERROR_TYPE_TCP_TRANSPORT:
      // errno 104 = conexión cerrada por el otro extremo, 113 = host inalcanzable, 119/128 = sin conexión
      Serial.printf("  motivo: error de red (errno %d)\n", errorSocket.load());
      break;
    case MQTT_ERROR_TYPE_CONNECTION_REFUSED:
      // 4 = usuario o clave incorrectos, 5 = no autorizado
      Serial.printf("  motivo: el broker rechazó la conexión (código %d)\n", errorCodigoConexion.load());
      break;
    default:
      Serial.println("  motivo: sin error informado (puede ser que no llegó la respuesta al PING)");
      break;
  }
}

void informarCambios() {
  static EstadoRed anterior = EstadoRed::SinWifi;
  EstadoRed actual = redEstado();
  if (actual == anterior) return;

  if (anterior == EstadoRed::SinWifi) {
    Serial.printf("WiFi conectado a \"%s\", IP %s\n", WIFI_SSID, WiFi.localIP().toString().c_str());
  }
  switch (actual) {
    case EstadoRed::SinWifi:
      Serial.println("WiFi desconectado");
      break;
    case EstadoRed::SinBroker:
      Serial.printf("[%lu s] Sin conexión con el broker %s:%lu\n", millis() / 1000, MQTT_HOST,
                    (unsigned long)MQTT_PORT);
      if (anterior == EstadoRed::Conectado) imprimirMotivo();
      break;
    case EstadoRed::Conectado:
      Serial.printf("[%lu s] Conectado al broker como \"%s\"\n", millis() / 1000, NODO_ID);
      break;
  }
  anterior = actual;
}

void publicar(const char *tipo, float valor, unsigned int decimales) {
  char topico[64];
  char payload[16];
  snprintf(topico, sizeof topico, "%s/sensor/%s", NODO_ID, tipo);
  if (isnan(valor)) {
    strcpy(payload, "nan");
  } else {
    snprintf(payload, sizeof payload, "%.*f", decimales, valor);
  }
  // publish (y no enqueue) para que salga en el momento: lo encolado lo envía la tarea de MQTT de a
  // un mensaje por vuelta (~1 por segundo), más lento de lo que se generan, y se acumulaba atraso.
  // Con la conexión establecida no bloquea; con la red trabada puede demorar hasta timeout_ms.
  esp_mqtt_client_publish(cliente, topico, payload, 0, QOS_LECTURAS, 0);
}

}  // namespace

void redIniciar() {
  colaOrdenes = xQueueCreate(8, sizeof(Orden));
  snprintf(topicoPresencia, sizeof topicoPresencia, "%s/presencia", NODO_ID);
  snprintf(filtroOrdenes, sizeof filtroOrdenes, "%s/actuador/+%s", NODO_ID, SUFIJO_ORDEN);
  snprintf(prefijoOrdenes, sizeof prefijoOrdenes, "%s/actuador/", NODO_ID);

  WiFi.setHostname(NODO_ID);  // así aparece en la lista de equipos del router
  WiFi.mode(WIFI_STA);
  // Sin ahorro de energía: con el modem dormido, los paquetes que llegan se demoran hasta el
  // próximo beacon del router, y las respuestas del broker (PING, PUBACK) pueden llegar tarde.
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Conectando al WiFi \"%s\"...\n", WIFI_SSID);

  esp_mqtt_client_config_t config = {};
  config.broker.address.hostname = MQTT_HOST;
  config.broker.address.port = MQTT_PORT;
  config.broker.address.transport = MQTT_TRANSPORT_OVER_TCP;
  config.credentials.client_id = NODO_ID;
  config.credentials.username = NODO_ID;
  config.credentials.authentication.password = MQTT_PASS;
  config.session.keepalive = KEEPALIVE_S;
  config.session.last_will.topic = topicoPresencia;
  config.session.last_will.msg = "offline";
  config.session.last_will.qos = QOS_PRESENCIA;
  config.session.last_will.retain = 1;
  config.network.reconnect_timeout_ms = RECONEXION_MS;

  cliente = esp_mqtt_client_init(&config);
  esp_mqtt_client_register_event(cliente, MQTT_EVENT_ANY, alEvento, nullptr);
}

bool redActualizar(Orden &orden) {
  // El cliente arranca recién con el primer WiFi; después reconecta solo, también si se corta el WiFi.
  if (!mqttIniciado && WiFi.status() == WL_CONNECTED) {
    esp_mqtt_client_start(cliente);
    mqttIniciado = true;
  }
  informarCambios();

  bool hubo = false;
  Orden nueva;
  while (xQueueReceive(colaOrdenes, &nueva, 0) == pdTRUE) {
    nueva.instante = millis();
    nueva.hay = true;
    Serial.printf("Orden recibida: %s -> %s\n", nueva.tipo, nueva.valor);
    orden = nueva;
    hubo = true;
  }
  return hubo;
}

EstadoRed redEstado() {
  if (WiFi.status() != WL_CONNECTED) return EstadoRed::SinWifi;
  return conectado ? EstadoRed::Conectado : EstadoRed::SinBroker;
}

void redPublicarLecturas(const Lecturas &lecturas) {
  if (!conectado) return;  // QoS 0: sin conexión la lectura se descarta, ya llega la próxima
  publicar("temperatura_suelo", lecturas.temperaturaSuelo, 1);
  publicar("temperatura_aire", lecturas.temperaturaAire, 1);
  publicar("humedad_aire", lecturas.humedadAire, 0);
}
