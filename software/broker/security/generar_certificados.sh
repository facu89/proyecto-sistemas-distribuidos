#!/usr/bin/env bash
# Script para generar la Autoridad Certificadora (CA) y el certificado del broker con soporte SAN (Subject Alternative Name).
# Uso:
#   ./generar_certificados.sh [IP_DEL_BROKER]
# Ejemplo:
#   ./generar_certificados.sh 192.168.1.50

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
mkdir -p "$DIR"

IP_EXTRA="${1:-192.168.1.50}"
SAN="DNS:localhost,DNS:emqx,IP:127.0.0.1"
if [ -n "$IP_EXTRA" ]; then
    SAN="$SAN,IP:$IP_EXTRA"
fi

echo "==> Generando certificados en: $DIR"
echo "==> SAN configurados: $SAN"

# 1. Generar CA raíz autofirmada
openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$DIR/ca.key" \
    -out "$DIR/ca.pem" \
    -days 3650 \
    -subj "/CN=PlantasCA"

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
