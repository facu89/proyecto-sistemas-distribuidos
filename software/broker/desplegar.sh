#!/usr/bin/env bash
# Sube el proyecto al servidor y lo levanta con compose.yaml + compose.servidor.yaml.
#
# Uso (desde cualquier carpeta del repo):
#   software/broker/desplegar.sh
#
# - Sube lo commiteado (HEAD), no los cambios sin commit: lo que corre en el servidor es siempre un commit.
#   Va por SSH (git archive | ssh), así el servidor no necesita acceso al repo privado de GitHub.
# - En el servidor queda en ~/bancal. La versión anterior queda en ~/bancal.anterior.
# - secrets/.env y los certificados (security/certs) del servidor no se tocan: se pasan de una versión a la otra.
# - La primera vez copia la CA local (ca.key y ca.pem) para que el ESP32 confíe en el broker del servidor
#   con el mismo firmware. Antes de la primera vez hay que crear secrets/.env en el servidor (ver README.md).
#
# Se puede cambiar el destino con variables: SERVIDOR=usuario@host PUERTO_SSH=22 software/broker/desplegar.sh

set -euo pipefail

SERVIDOR="${SERVIDOR:-alumno@100.117.231.80}"
PUERTO_SSH="${PUERTO_SSH:-22116}"
CARPETA=bancal

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(git -C "$AQUI" rev-parse --show-toplevel)"
cd "$RAIZ"

remoto() { ssh -p "$PUERTO_SSH" "$SERVIDOR" "$@"; }

if ! git diff --quiet HEAD -- software diseño_pagina_web; then
    echo "==> Aviso: hay cambios sin commit en software/ o diseño_pagina_web/. Se sube HEAD ($(git rev-parse --short HEAD))."
fi

# 1. Código: se arma ~/bancal.nuevo con lo commiteado (solo lo que hace falta para compose)
echo "==> Subiendo $(git rev-parse --short HEAD) a $SERVIDOR:~/$CARPETA"
remoto "rm -rf ~/$CARPETA.nuevo && mkdir ~/$CARPETA.nuevo"
git archive --format=tar HEAD software diseño_pagina_web .dockerignore | remoto "tar -x -C ~/$CARPETA.nuevo"

# 2. Se pasan secretos y certificados de la versión actual a la nueva, y se reemplaza
remoto bash -s -- "$CARPETA" <<'EOF'
set -e
cd ~
C="$1"
if [ -d "$C" ]; then
    for d in software/broker/secrets software/broker/security/certs; do
        if [ -d "$C/$d" ]; then
            rm -rf "$C.nuevo/$d"
            mkdir -p "$(dirname "$C.nuevo/$d")"
            mv "$C/$d" "$C.nuevo/$d"
        fi
    done
    rm -rf "$C.anterior"
    mv "$C" "$C.anterior"
fi
mv "$C.nuevo" "$C"
mkdir -p "$C/software/broker/security/certs"
EOF

# 3. La primera vez, la CA local. ca.pem sale de la copia que usó el firmware (firmware/certs/ca.pem),
#    que es la que tiene grabada el ESP32; se verifica que corresponda a ca.key antes de subirla.
CERTS_REMOTOS="$CARPETA/software/broker/security/certs"
if ! remoto "test -f ~/$CERTS_REMOTOS/ca.key"; then
    CA_KEY="$AQUI/security/certs/ca.key"
    CA_PEM="$RAIZ/firmware/certs/ca.pem"
    [ -f "$CA_PEM" ] || CA_PEM="$AQUI/security/certs/ca.pem"
    if [ ! -f "$CA_KEY" ] || [ ! -f "$CA_PEM" ]; then
        echo "ERROR: no encuentro la CA local ($CA_KEY y firmware/certs/ca.pem)." >&2
        exit 1
    fi
    if [ "$(openssl x509 -in "$CA_PEM" -noout -pubkey)" != "$(openssl pkey -in "$CA_KEY" -pubout)" ]; then
        echo "ERROR: $CA_PEM no corresponde a $CA_KEY." >&2
        exit 1
    fi
    echo "==> Copiando la CA local al servidor (la misma que tiene grabada el ESP32)"
    scp -q -P "$PUERTO_SSH" "$CA_KEY" "$CA_PEM" "$SERVIDOR:$CERTS_REMOTOS/"
    remoto "chmod 600 ~/$CERTS_REMOTOS/ca.key"
fi

# 4. Sin secrets/.env no se puede levantar
if ! remoto "test -f ~/$CARPETA/software/broker/secrets/.env"; then
    echo "ERROR: falta secrets/.env en el servidor. Ver software/broker/README.md, sección \"Servidor\"." >&2
    exit 1
fi

# 5. Levantar (o actualizar: compose solo recrea lo que cambió)
echo "==> Levantando con docker compose (la primera vez tarda: compila la imagen del servicio)"
remoto "cd ~/$CARPETA/software/broker && docker compose -f compose.yaml -f compose.servidor.yaml up -d --build --remove-orphans && docker compose -f compose.yaml -f compose.servidor.yaml ps"
