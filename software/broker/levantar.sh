#!/usr/bin/env bash
# Levanta el broker (EMQX + MySQL) comprobando antes que el certificado TLS incluya las IPs actuales de
# esta máquina. Si cambió la red o la IP (otra WiFi, el router asignó otra), regenera el certificado del
# broker con la misma CA y reinicia EMQX para que lo cargue.
#
# Uso (desde cualquier carpeta):
#   software/broker/levantar.sh
#
# Funciona con Podman (podman compose) o con Docker (docker compose).

set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if command -v podman >/dev/null 2>&1; then
    MOTOR=podman
else
    MOTOR=docker
fi

CERT=security/certs/broker.pem
mapfile -t IPS < <(security/ips_locales.sh)

faltantes=()
if [ -f "$CERT" ]; then
    san="$(openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null || true)"
    for ip in "${IPS[@]}"; do
        # "IP Address:10.15.0.39," o al final de la línea
        grep -qE "IP Address:${ip//./\\.}(,|$)" <<<"$san" || faltantes+=("$ip")
    done
fi

regenerado=no
if [ ! -f "$CERT" ] || [ "${#faltantes[@]}" -gt 0 ]; then
    if [ -f "$CERT" ]; then
        echo "==> El certificado del broker no incluye ${faltantes[*]}: se regenera"
    fi
    security/generar_certificados.sh "${IPS[@]}"
    regenerado=si
else
    echo "==> El certificado del broker ya incluye las IPs actuales (${IPS[*]:-ninguna})"
fi

"$MOTOR" compose up -d

# Si EMQX ya estaba corriendo, "compose up" no lo reinicia: hay que hacerlo para que lea el certificado nuevo.
if [ "$regenerado" = si ] && "$MOTOR" ps --format '{{.Names}}' | grep -qx emqx; then
    echo "==> Reiniciando EMQX para que cargue el certificado nuevo"
    "$MOTOR" restart emqx >/dev/null
fi

echo
echo "==> Broker listo. En firmware/include/config.h del ESP32 va MQTT_PORT = 8883 y en MQTT_HOST"
echo "    la IP de esta máquina en la red del ESP32 (si cambió, hay que volver a grabar el firmware):"
for ip in "${IPS[@]}"; do
    echo "      $ip"
done
