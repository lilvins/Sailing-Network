# Sailing Network — one container: the built site and the API in one process.
#
#   docker build -t sailing-network .
#   docker run -p 8787:8787 -v sailing-data:/data --env-file .env sailing-network
#
# /data is the only place that must survive a redeploy: the SQLite database
# and, if you keep them there, the card images (see .env.example).
# One container only: friend games live in the process memory and SQLite has
# one writer, so this image must not be scaled to several instances.

# ── 1. build the site ────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── 2. the server, with production dependencies only ─────────────────────────
FROM node:24-slim
ENV NODE_ENV=production \
    SN_DB_PATH=/data/sailing.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
# the seeds read the card list from here (npm run seed:cards)
COPY public/data ./public/data
COPY --from=build /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8787
# hosts that set PORT (Render, Railway, Fly) are followed; 8787 otherwise
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SN_API_PORT||process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
