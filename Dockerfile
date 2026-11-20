# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Tailwind is compiled at build time so the app never depends on a CSS CDN at runtime.
FROM ${NODE_IMAGE} AS css
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tailwind.config.js index.html index.js ./
COPY src ./src
RUN npm run build:css

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3005 \
    DB_FILE=/data/game.db \
    IMAGE_CACHE_DIR=/data/image-cache

RUN apk add --no-cache tini \
 && apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && mkdir -p /data && chown node:node /data

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json index.html index.js sw.js ./
COPY src ./src
COPY asset ./asset
COPY --from=css /app/asset/vendor/tailwind.css ./asset/vendor/tailwind.css
COPY server ./server

USER node
EXPOSE 3005
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/server.js"]
