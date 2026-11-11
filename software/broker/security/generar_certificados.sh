#!/usr/bin/env bash
# Script para generar la Autoridad Certificadora (CA) y el certificado del broker con soporte SAN (Subject Alternative Name).
# Uso:
#   ./generar_certificados.sh                      # usa las IPs actuales de esta máquina (ips_locales.sh)
#   ./generar_certificados.sh IP|NOMBRE [...]      # o las IPs y nombres que se le pasen
# Ejemplo:
#   ./generar_certificados.sh 192.168.1.50 10.15.0.39 bancal.taile538b8.ts.net
#
# El ESP32 verifica que la IP o el nombre al que se conecta (MQTT_HOST en firmware/include/config.h)
# figure en el certificado. Si la máquina del broker cambia de red o de IP hay que regenerarlo y reiniciar EMQX:
# ../levantar.sh lo hace solo.
#
# Si la CA ya existe (certs/ca.pem y certs/ca.key) se reutiliza y solo se regenera el certificado del
# broker: así ca.pem no cambia y el firmware ya grabado (que la embebe) sigue sirviendo. Para crear una
# CA nueva, borrar certs/ca.pem y certs/ca.key antes (y recompilar el firmware después).

set -e
# Git Bash (Windows) convierte "/CN=..." en una ruta de Windows y openssl falla: así no toca esos argumentos
# (las demás rutas, como las de mktemp, sí se tienen que convertir). En Linux no hace nada.
export MSYS2_ARG_CONV_EXCL="/CN="

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$AQUI/certs"
mkdir -p "$DIR"

# En el contenedor "certs" (ver preparar_certificados.sh) no está ips_locales.sh: ahí las IPs llegan
# siempre como argumentos, porque desde adentro de un contenedor no se ven las IPs de la máquina.
if [ "$#" -eq 0 ] && [ -f "$AQUI/ips_locales.sh" ]; then
    # shellcheck disable=SC2046
    set -- $("$AQUI/ips_locales.sh")
    if [ "$#" -eq 0 ]; then
        echo "==> No se encontró ninguna IP de red: el certificado solo va a servir para localhost" >&2
    else
        echo "==> IPs detectadas en esta máquina: $*"
    fi
fi
SAN="DNS:localhost,DNS:emqx,IP:127.0.0.1"
for host in "$@"; do
    # IPv4 (solo dígitos y puntos) o IPv6 (lleva ":") va como IP; lo demás es un nombre (DNS)
    if [[ "$host" =~ ^[0-9.]+$ || "$host" == *:* ]]; then
        SAN="$SAN,IP:$host"
    else
        SAN="$SAN,DNS:$host"
    fi
done

echo "==> Generando certificados en: $DIR"
echo "==> SAN configurados: $SAN"

# 1. Generar CA raíz autofirmada (solo si no existe)
if [ -f "$DIR/ca.pem" ] && [ -f "$DIR/ca.key" ]; then
    echo "==> Se reutiliza la CA existente (ca.pem no cambia)"
else
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$DIR/ca.key" \
        -out "$DIR/ca.pem" \
        -days 3650 \
        -subj "/CN=PlantasCA"
fi

# 2. Generar clave privada del broker y CSR con extensiones SAN
openssl req -newkey rsa:2048 -nodes \
    -keyout "$DIR/broker.key" \
    -out "$DIR/broker.csr" \
    -subj "/CN=emqx" \
    -addext "subjectAltName = $SAN"

# 3. Firmar el certificado del broker con la CA preservando las extensiones SAN
openssl x509 -req \
    -in "$DIR/broker.csr" \
    -CA "$DIR/ca.pem" \
    -CAkey "$DIR/ca.key" \
    -CAcreateserial \
    -out "$DIR/broker.pem" \
    -days 365 \
    -copy_extensions copy

# 4. Crear copias de compatibilidad (por nombres estándar en configs de EMQX)
cp "$DIR/ca.pem" "$DIR/cacert.pem"
cp "$DIR/broker.pem" "$DIR/cert.pem"
cp "$DIR/broker.key" "$DIR/key.pem"

echo "==> ¡Certificados y claves generados exitosamente con soporte SAN (X509v3)!"
