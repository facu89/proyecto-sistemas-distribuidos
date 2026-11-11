# Copia a firmware/certs/ los certificados que el ESP32 lleva embebidos, antes de compilar:
#   - ca.pem: la CA del broker, para verificar su certificado.
#   - cliente.pem y cliente.key: el certificado y la clave privada de ESTE ESP32 para TLS mutuo (el broker
#     exige un certificado de cliente). Son los de NODO_ID (include/config.h), que genera el contenedor
#     "certs" de software/broker en security/certs/clientes/ (ver generar_cliente.sh).
# platformio.ini los embebe desde ahí (board_build.embed_txtfiles), y como la ruta es relativa al proyecto,
# los símbolos son siempre _binary_certs_<archivo>_start, en cualquier computadora.
# firmware/certs/ no se sube a git: la clave privada del ESP32 queda solo en esta máquina y en la placa.

import os
import re
import shutil

Import("env")  # noqa: F821 (lo define PlatformIO)

proyecto = env.subst("$PROJECT_DIR")  # noqa: F821
certs = os.path.normpath(os.path.join(proyecto, "..", "software", "broker", "security", "certs"))
destino = os.path.join(proyecto, "certs")

with open(os.path.join(proyecto, "include", "config.h"), encoding="utf-8") as f:
    encontrado = re.search(r'NODO_ID\s*=\s*"([^"]+)"', f.read())
if not encontrado:
    raise SystemExit("No encuentro NODO_ID en include/config.h")
nodo = encontrado.group(1)

copias = {
    os.path.join(certs, "ca.pem"): "ca.pem",
    os.path.join(certs, "clientes", nodo + ".pem"): "cliente.pem",
    os.path.join(certs, "clientes", nodo + ".key"): "cliente.key",
}
for origen in copias:
    if not os.path.isfile(origen):
        raise SystemExit(
            "Falta " + origen + ": levantá el broker (docker compose up -d en software/broker), que genera los "
            "certificados. Para el de este ESP32, NODOS_TLS (o MQTT_ESP_USER) en secrets/.env tiene que incluir " + nodo
        )

os.makedirs(destino, exist_ok=True)
for origen, nombre in copias.items():
    shutil.copyfile(origen, os.path.join(destino, nombre))
print("Certificados de " + nodo + " copiados a firmware/certs/")
