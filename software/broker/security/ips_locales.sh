#!/usr/bin/env bash
# Imprime, una por línea, las IPv4 de esta máquina en las redes donde pueden estar los ESP32 (WiFi,
# Ethernet, VPN). Deja afuera loopback y las interfaces virtuales de Podman/Docker/libvirt, que los ESP32
# no ven. La usan generar_certificados.sh (para el SAN del certificado) y ../levantar.sh.

set -e

if command -v ip >/dev/null 2>&1; then
    # Formato de "ip -o": "3: wlp2s0    inet 10.15.0.39/22 brd ... scope global ..."
    ip -4 -o addr show scope global \
        | awk '$2 !~ /^(lo|docker|podman|br-|veth|cni|virbr|vnet|flannel)/ { split($4, a, "/"); print a[1] }'
elif command -v hostname >/dev/null 2>&1 && hostname -I >/dev/null 2>&1; then
    hostname -I | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -vE '^(127\.|10\.88\.|172\.17\.)'
fi
