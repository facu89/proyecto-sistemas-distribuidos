#!/usr/bin/env bash
# Certificado de cliente para TLS mutuo: certs/clientes/NOMBRE.pem y NOMBRE.key, firmado por la CA.
#   ./generar_cliente.sh NOMBRE [DIAS]      (DIAS por defecto: 3650)
#
# NOMBRE es el usuario MQTT del cliente (servicio, bancal1esp1...): EMQX toma el CN del certificado como
# usuario (peer_cert_as_username en config/emqx.conf), así un certificado solo sirve para su propio usuario.
# Si ya hay uno que firmó la CA actual, que coincide con su clave y al que le quedan más de 30 días, no se
# toca. Lo corre preparar_certificados.sh en cada "compose up"; también se puede correr a mano.

set -e

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C="$AQUI/certs"
D="$C/clientes"
NOMBRE="${1:?Uso: generar_cliente.sh NOMBRE [DIAS]}"
DIAS="${2:-3650}"
[[ "$NOMBRE" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "ERROR: nombre de cliente inválido: $NOMBRE" >&2; exit 1; }
mkdir -p "$D"
PEM="$D/$NOMBRE.pem"
KEY="$D/$NOMBRE.key"

if [ -f "$PEM" ] && [ -f "$KEY" ] \
    && openssl verify -CAfile "$C/ca.pem" "$PEM" >/dev/null 2>&1 \
    && [ "$(openssl x509 -in "$PEM" -noout -pubkey)" = "$(openssl pkey -in "$KEY" -pubout)" ] \
    && openssl x509 -in "$PEM" -noout -checkend $((30 * 24 * 3600)) >/dev/null; then
    echo "==> Certificado de cliente de $NOMBRE: está bien (vence $(openssl x509 -in "$PEM" -noout -enddate | cut -d= -f2))"
    exit 0
fi

echo "==> Certificado de cliente de $NOMBRE: se genera ($DIAS días)"
EXT="$(mktemp)"
printf 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n' > "$EXT"
openssl req -newkey rsa:2048 -nodes -keyout "$KEY" -out "$D/$NOMBRE.csr" -subj "/CN=$NOMBRE" 2>/dev/null
openssl x509 -req -in "$D/$NOMBRE.csr" -CA "$C/ca.pem" -CAkey "$C/ca.key" -CAcreateserial \
    -out "$PEM" -days "$DIAS" -extfile "$EXT" 2>/dev/null
rm -f "$D/$NOMBRE.csr" "$EXT"
# Lo leen el contenedor del servicio y el script del firmware, que pueden correr con otro usuario
chmod 644 "$KEY" "$PEM"
