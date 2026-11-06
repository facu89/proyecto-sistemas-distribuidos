# Copia la CA del broker a firmware/certs/ca.pem antes de compilar.
# platformio.ini la embebe desde ahí (board_build.embed_txtfiles), y como la ruta es relativa al
# proyecto, el símbolo queda siempre _binary_certs_ca_pem_start, en cualquier computadora.
# Si se regeneran los certificados del broker, alcanza con volver a compilar y grabar el ESP32.

import os
import shutil

Import("env")  # noqa: F821 (lo define PlatformIO)

proyecto = env.subst("$PROJECT_DIR")  # noqa: F821
origen = os.path.normpath(os.path.join(proyecto, "..", "software", "broker", "security", "certs", "ca.pem"))
destino = os.path.join(proyecto, "certs", "ca.pem")

if not os.path.isfile(origen):
    raise SystemExit("Falta " + origen + ": generá los certificados con generar_certificados.sh")

os.makedirs(os.path.dirname(destino), exist_ok=True)
shutil.copyfile(origen, destino)
