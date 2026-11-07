#!/usr/bin/env bash
# Lo corre el contenedor "certs" de compose.yaml cada vez que se hace "compose up", antes de arrancar EMQX.
# Deja listo el certificado TLS del broker y solo lo regenera (con generar_certificados.sh) si hace falta:
#   - no existe, o falta su clave;
#   - no lo firmó la CA actual (ca.pem);
#   - no coincide con su clave privada (broker.key);
#   - vence en menos de 30 días;
#   - no incluye alguna de las IPs de BROKER_IP (secrets/.env).
# Si está todo bien, no toca nada.
#
# BROKER_IP es la IP de la máquina del broker en la red del ESP32 (la misma que MQTT_HOST en
# firmware/include/config.h). Desde adentro del contenedor no se puede averiguar, por eso va en .env.
# Se pueden poner varias separadas por coma. Si está vacía, el certificado sirve solo para el servicio
# (que se conecta por el nombre "emqx") y para localhost.

set -e

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C="$AQUI/certs"
cd "$C"

read -r -a IPS <<< "$(echo "${BROKER_IP:-}" | tr ',;' '  ')"

clave_publica_cert() { openssl x509 -in "$1" -noout -pubkey 2>/dev/null; }
clave_publica_key()  { openssl pkey -in "$1" -pubout 2>/dev/null; }

# Los certificados no están en git: cada máquina tiene los suyos. Si quedó la clave de la CA pero no su
# certificado (por ejemplo, git borró ca.pem en un pull cuando se lo sacó del repo), se rearma ca.pem con
# la misma clave y el mismo nombre. El ESP32 ya grabado lo sigue aceptando, porque verifica la firma con
# esa clave; así no hace falta volver a grabarlo.
if [ ! -f ca.pem ] && [ -f ca.key ]; then
    echo "==> Falta ca.pem pero está ca.key: se rearma ca.pem con la misma clave (el ESP32 sigue sirviendo)"
    openssl req -x509 -new -key ca.key -out ca.pem -days 3650 -subj "/CN=PlantasCA"
    cp ca.pem cacert.pem
fi

motivo=""
if [ ! -f broker.pem ] || [ ! -f broker.key ]; then
    motivo="no existe"
elif [ ! -f ca.pem ] || ! openssl verify -CAfile ca.pem broker.pem >/dev/null 2>&1; then
    motivo="no lo firmó la CA actual (ca.pem)"
elif [ "$(clave_publica_cert broker.pem)" != "$(clave_publica_key broker.key)" ]; then
    motivo="no coincide con su clave privada (broker.key)"
elif ! openssl x509 -in broker.pem -noout -checkend $((30 * 24 * 3600)) >/dev/null; then
    motivo="vence en menos de 30 días"
else
    san="$(openssl x509 -in broker.pem -noout -ext subjectAltName)"
    faltan=()
    for ip in "${IPS[@]}"; do
        grep -qE "IP Address:${ip//./\\.}(,|$)" <<< "$san" || faltan+=("$ip")
    done
    if [ "${#faltan[@]}" -gt 0 ]; then
        motivo="no incluye ${faltan[*]}"
    fi
fi

if [ -z "$motivo" ]; then
    echo "==> El certificado del broker está bien (IPs: ${IPS[*]:-ninguna}). No se cambia nada."
    exit 0
fi
echo "==> El certificado del broker $motivo: se regenera"

# Para firmar hace falta la clave de la CA. Si ca.pem y ca.key son de CAs distintas (pasa cuando alguien
# sube a git su ca.pem y acá quedó la ca.key de otra), no se puede firmar y no conviene adivinar cuál vale.
if [ -f ca.pem ] && [ -f ca.key ] && [ "$(clave_publica_cert ca.pem)" != "$(clave_publica_key ca.key)" ]; then
    echo "ERROR: certs/ca.pem y certs/ca.key son de CAs distintas, no se puede firmar el certificado." >&2
    echo "  - Para seguir usando la CA que ya tiene grabada el ESP32: poner en certs/ca.pem la que le corresponde" >&2
    echo "    (la copia que usó el firmware está en firmware/certs/ca.pem)." >&2
    echo "  - Para empezar de cero: borrar certs/ca.pem y certs/ca.key, y después recompilar y grabar el ESP32." >&2
    exit 1
fi
if [ ! -f ca.key ]; then
    echo "==> No hay clave de CA (certs/ca.key): se crea una CA nueva."
    echo "    El ESP32 tiene que recompilarse y grabarse para que confíe en ella."
fi

"$AQUI/generar_certificados.sh" "${IPS[@]}"

# EMQX corre con su propio usuario y tiene que poder leer la clave (en Linux el archivo queda del root
# del contenedor). ca.key no la lee nadie más que este contenedor, así que esa se deja privada.
chmod 644 broker.key key.pem
