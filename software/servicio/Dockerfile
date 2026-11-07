# Imagen del servicio. La usa software/broker/compose.yaml con la raíz del repo como contexto, porque
# también compila la web (diseño_pagina_web/web), que el servicio sirve en el puerto 8080.
# Así no hace falta tener Node ni pnpm instalados: todo se compila adentro de la imagen.

FROM node:24-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate

# --- Etapa 1: compila la web --------------------------------------------------------------------
# Se mantiene la estructura de carpetas del repo: la web importa los modelos 3D de ../modelos y los
# tipos del estado de los bancales desde software/servicio/src/bancal.ts.
FROM base AS web
WORKDIR /repo/diseño_pagina_web/web
COPY diseño_pagina_web/web/package.json diseño_pagina_web/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY diseño_pagina_web/modelos /repo/diseño_pagina_web/modelos
COPY software/servicio/src /repo/software/servicio/src
COPY diseño_pagina_web/web/ ./
RUN pnpm build

# --- Etapa 2: el servicio -----------------------------------------------------------------------
# Node corre el TypeScript directamente (sin compilar), así que solo hacen falta las dependencias
# de producción (mqtt) y el código.
FROM base
WORKDIR /app
COPY software/servicio/package.json software/servicio/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY software/servicio/src ./src
COPY --from=web /repo/diseño_pagina_web/web/dist ./web

ENV NODE_ENV=production \
    WEB_DIST=/app/web
EXPOSE 8080
CMD ["node", "src/main.ts"]
