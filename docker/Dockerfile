# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ───────────────────────────────────────────────────
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

# ── Stage 3: Production image ────────────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app

# Setup file storage directory owned by 'node' user
RUN mkdir -p /var/lib/zalo-crm/files /app/static && chown -R node:node /var/lib/zalo-crm/files /app

# Copy built artefacts directly with correct user ownership (prevents layer duplication)
COPY --chown=node:node --from=backend-builder /app/backend/dist        /app/dist
COPY --chown=node:node --from=backend-builder /app/backend/node_modules /app/node_modules
COPY --chown=node:node --from=backend-builder /app/backend/prisma      /app/prisma
COPY --chown=node:node --from=backend-builder /app/backend/package.json  /app/package.json
COPY --chown=node:node --from=frontend-builder /app/frontend/dist      /app/static

USER node

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# Execute database migration/push safely then start application
CMD ["sh", "-c", "npx prisma db push --url \"$DATABASE_URL\" && node dist/app.js"]
