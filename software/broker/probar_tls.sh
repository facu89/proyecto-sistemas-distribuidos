#!/usr/bin/env bash
# Prueba (y muestra) que el broker está protegido con TLS, con openssl, contra el broker local o el servidor.
#
#   software/broker/probar_tls.sh             # broker local (localhost:8883)
#   software/broker/probar_tls.sh servidor    # servidor (bancal.taile538b8.ts.net:443, por internet)
#
# Cada prueba dice qué se espera y qué pasó. Solo hace el saludo TLS: no inicia sesión MQTT ni publica nada,
# así que no molesta al ESP32 ni al servicio conectados.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
C=security/certs

if [ "${1:-}" = servidor ]; then
    HOST=bancal.taile538b8.ts.net
    PUERTO=443
else
    HOST=localhost
    PUERTO=8883
fi
DESTINO="$HOST:$PUERTO"
CLIENTE=$C/clientes/servicio

bien=0
mal=0
resultado() { # $1 = 0 si salió como se esperaba
    if [ "$1" -eq 0 ]; then echo "   ✔ OK"; bien=$((bien + 1)); else echo "   ✘ FALLÓ"; mal=$((mal + 1)); fi
    echo
}
# Saludo TLS que se mantiene abierto 2 s, para recibir la respuesta del broker después del saludo (con TLS
# 1.3, el rechazo por falta de certificado de cliente llega recién ahí).
saludo() { (sleep 2) | timeout 10 openssl s_client -connect "$DESTINO" -servername "$HOST" "$@" 2>&1; }

echo "== Probando TLS en $DESTINO"
echo

echo "1. El broker presenta un certificado firmado por NUESTRA CA y con el nombre correcto"
salida="$(saludo -CAfile $C/ca.pem -verify_hostname "$HOST" -verify_return_error -cert $CLIENTE.pem -key $CLIENTE.key)"
grep -E "^subject=|^issuer=|Verify return code|New, TLS|Cipher is" <<< "$salida" | sort -u | sed 's/^/   /'
grep -q "Verify return code: 0 (ok)" <<< "$salida"; resultado $?

echo "2. Si el cliente NO confía en nuestra CA (usa las del sistema), rechaza al broker: nadie puede hacerse pasar por él con otro certificado"
salida="$(saludo -verify_hostname "$HOST" -verify_return_error)"
grep -E "Verify return code|verify error" <<< "$salida" | head -2 | sed 's/^/   /'
grep -q "Verify return code: 0 (ok)" <<< "$salida"; [ $? -ne 0 ]; resultado $?

echo "3. Si el nombre no coincide (como en un ataque de intermediario), también lo rechaza"
salida="$(saludo -CAfile $C/ca.pem -verify_hostname otro-nombre.ejemplo -verify_return_error)"
grep -E "Verify return code|verify error" <<< "$salida" | head -1 | sed 's/^/   /'
grep -q "Verify return code: 0 (ok)" <<< "$salida"; [ $? -ne 0 ]; resultado $?

echo "4. TLS mutuo: un cliente SIN certificado queda afuera antes de poder probar una clave"
salida="$(saludo -CAfile $C/ca.pem)"
grep -oE "alert certificate required|SSL alert number [0-9]+" <<< "$salida" | sort -u | sed 's/^/   /'
grep -q "alert certificate required\|SSL alert number 116" <<< "$salida"; resultado $?

echo "5. TLS mutuo: con un certificado de cliente nuestro, el broker lo acepta"
salida="$(saludo -CAfile $C/ca.pem -cert $CLIENTE.pem -key $CLIENTE.key)"
grep -oE "alert certificate required|SSL alert number [0-9]+" <<< "$salida" | sed 's/^/   /'
! grep -q "SSL alert" <<< "$salida" && grep -q "Verify return code: 0 (ok)" <<< "$salida"; resultado $?

echo "6. Un certificado de cliente hecho por otra CA (uno cualquiera, autofirmado) también queda afuera"
falso="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$falso/k" -out "$falso/c" -days 1 -subj "/CN=servicio" 2>/dev/null
salida="$(saludo -CAfile $C/ca.pem -cert "$falso/c" -key "$falso/k")"
rm -rf "$falso"
grep -oE "alert [a-z ]+|SSL alert number [0-9]+" <<< "$salida" | sort -u | head -2 | sed 's/^/   /'
grep -q "SSL alert" <<< "$salida"; resultado $?

if [ "$HOST" = localhost ]; then
    echo "7. MQTT sin cifrar (1883) y WebSocket (8083) están cerrados"
    abiertos=0
    for p in 1883 8083; do
        if timeout 3 bash -c "</dev/tcp/127.0.0.1/$p" 2>/dev/null; then echo "   $p: ABIERTO"; abiertos=1; else echo "   $p: cerrado"; fi
    done
    [ $abiertos -eq 0 ]; resultado $?
fi

echo "== $bien bien, $mal mal"
[ $mal -eq 0 ]
