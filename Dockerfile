# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Install all deps (including dev) for the TypeScript build.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build.
COPY tsconfig.json tsconfig.build.json ./
COPY drizzle.config.ts ./
COPY src ./src
RUN npm run build

# The TypeScript build doesn't carry .sql files. Migration assets live at
# src/db/migrations/ — copy them next to the built migrate.js so the runtime
# can resolve them via __dirname.
RUN cp -r src/db/migrations dist/db/migrations

# Prune dev dependencies for the runtime stage.
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Use the unprivileged 'node' user that ships with the official image.
RUN mkdir -p /app && chown -R node:node /app

# Copy the built artefacts and production-only node_modules.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

# Fly's checks also hit /healthz, but a Docker-native HEALTHCHECK is useful
# for local / non-Fly deploys.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
