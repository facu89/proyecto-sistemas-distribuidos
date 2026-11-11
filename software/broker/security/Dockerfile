# Imagen del contenedor "certs" de compose.yaml: solo trae OpenSSL y los scripts que generan los
# certificados. Los certificados en sí no van en la imagen: se escriben en certs/, montada como volumen.
FROM alpine:3.20

RUN apk add --no-cache bash openssl

WORKDIR /security
COPY generar_certificados.sh preparar_certificados.sh generar_cliente.sh ./
# Por si los scripts se clonaron en Windows con fin de línea CRLF (bash no los correría)
RUN sed -i 's/\r$//' ./*.sh && chmod +x ./*.sh

ENTRYPOINT ["/security/preparar_certificados.sh"]
